package config

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

var loadLocalEnvOnce sync.Once

type envFileCandidate struct {
	path            string
	backendFallback bool
}

var backendFallbackIgnoredKeys = map[string]struct{}{
	"API_HOST": {},
	"API_PORT": {},
}

func loadLocalEnv() {
	loadLocalEnvOnce.Do(func() {
		for _, candidate := range candidateEnvFiles() {
			if loadEnvFile(candidate.path, candidate.backendFallback) {
				return
			}
		}
	})
}

func candidateEnvFiles() []envFileCandidate {
	paths := make([]envFileCandidate, 0, 4)
	seen := map[string]struct{}{}
	add := func(path string, backendFallback bool) {
		if path == "" {
			return
		}
		cleaned := filepath.Clean(path)
		if _, ok := seen[cleaned]; ok {
			return
		}
		seen[cleaned] = struct{}{}
		paths = append(paths, envFileCandidate{path: cleaned, backendFallback: backendFallback})
	}

	if cwd, err := os.Getwd(); err == nil {
		add(filepath.Join(cwd, ".env"), false)
		add(filepath.Join(cwd, "..", "backend", ".env"), true)
	}

	if _, file, _, ok := runtime.Caller(0); ok {
		configDir := filepath.Dir(file)
		goRoot := filepath.Clean(filepath.Join(configDir, "..", ".."))
		add(filepath.Join(goRoot, ".env"), false)
		add(filepath.Join(goRoot, "..", "backend", ".env"), true)
	}

	return paths
}

func loadEnvFile(path string, backendFallback bool) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	loaded := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if backendFallback && shouldIgnoreBackendFallbackKey(key) {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if err := os.Setenv(key, value); err == nil {
			loaded = true
		}
	}

	return loaded
}

func shouldIgnoreBackendFallbackKey(key string) bool {
	_, ignored := backendFallbackIgnoredKeys[strings.ToUpper(strings.TrimSpace(key))]
	return ignored
}
