package main

import (
	"log"

	"graphinsight/go-backend/internal/app"
)

func main() {
	if err := app.Run(); err != nil {
		log.Fatalf("go api exited with error: %v", err)
	}
}
