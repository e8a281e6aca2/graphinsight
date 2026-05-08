package httpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var ErrIdempotencyConflict = errors.New("idempotency key already used with different payload")

type idempotencyResponse struct {
	status int
	body   []byte
}

type idempotencyEntry struct {
	requestHash string
	inFlight    bool
	done        chan struct{}
	response    idempotencyResponse
	err         error
	expiresAt   time.Time
}

type idempotencyStore struct {
	mu      sync.Mutex
	items   map[string]*idempotencyEntry
	ttl     time.Duration
	nowFunc func() time.Time
}

func newIdempotencyStore(ttl time.Duration) *idempotencyStore {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &idempotencyStore{
		items:   make(map[string]*idempotencyEntry),
		ttl:     ttl,
		nowFunc: time.Now,
	}
}

func (s *idempotencyStore) execute(
	ctx context.Context,
	key string,
	requestBody []byte,
	executor func() (int, []byte, error),
) (int, []byte, error) {
	if s == nil || key == "" {
		return executor()
	}

	hash := hashRequestBody(requestBody)

	for {
		entry, isLeader, err := s.begin(key, hash)
		if err != nil {
			return 0, nil, err
		}
		if isLeader {
			status, body, execErr := executor()
			s.finish(key, status, body, execErr)
			return status, body, execErr
		}

		select {
		case <-ctx.Done():
			return 0, nil, ctx.Err()
		case <-entry.done:
		}

		s.mu.Lock()
		current, ok := s.items[key]
		if !ok {
			s.mu.Unlock()
			continue
		}
		if current.requestHash != hash {
			s.mu.Unlock()
			return 0, nil, ErrIdempotencyConflict
		}
		if current.inFlight {
			s.mu.Unlock()
			continue
		}
		status := current.response.status
		body := append([]byte(nil), current.response.body...)
		errCopy := current.err
		s.mu.Unlock()
		return status, body, errCopy
	}
}

func (s *idempotencyStore) begin(key, requestHash string) (*idempotencyEntry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.nowFunc()
	s.cleanupLocked(now)

	existing, ok := s.items[key]
	if ok {
		if existing.requestHash != requestHash {
			return nil, false, ErrIdempotencyConflict
		}
		return existing, false, nil
	}

	entry := &idempotencyEntry{
		requestHash: requestHash,
		inFlight:    true,
		done:        make(chan struct{}),
		expiresAt:   now.Add(s.ttl),
	}
	s.items[key] = entry
	return entry, true, nil
}

func (s *idempotencyStore) finish(key string, status int, body []byte, execErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.items[key]
	if !ok {
		return
	}
	entry.inFlight = false
	entry.response = idempotencyResponse{status: status, body: append([]byte(nil), body...)}
	entry.err = execErr
	entry.expiresAt = s.nowFunc().Add(s.ttl)
	select {
	case <-entry.done:
	default:
		close(entry.done)
	}
}

func (s *idempotencyStore) cleanupLocked(now time.Time) {
	for k, item := range s.items {
		if item.inFlight {
			continue
		}
		if now.After(item.expiresAt) {
			delete(s.items, k)
		}
	}
}

func hashRequestBody(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
