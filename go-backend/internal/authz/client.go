package authz

import (
	"errors"
)

var ErrUnauthorized = errors.New("unauthorized")
var ErrForbidden = errors.New("forbidden")

type CheckResult struct {
	Allowed bool
	Reason  string
	UserID  int
	User    string
	Email   string
	Scope   map[string]string
}
