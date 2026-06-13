package adminstore

import "testing"

func TestPercentileFloatsMatchesPythonSnapshotSelection(t *testing.T) {
	t.Parallel()

	values := []float64{10, 20, 30, 40, 50}
	if got := percentileFloats(values, 0.50); got != 30 {
		t.Fatalf("expected p50 30, got %v", got)
	}
	if got := percentileFloats(values, 0.95); got != 50 {
		t.Fatalf("expected p95 50, got %v", got)
	}
	if got := percentileFloats([]float64{10, 20, 30}, 0.25); got != 20 {
		t.Fatalf("expected rounded index p25 20, got %v", got)
	}
	if got := percentileFloats(nil, 0.95); got != 0 {
		t.Fatalf("expected empty percentile 0, got %v", got)
	}
}

func TestAverageFloatsRoundsToThreePlaces(t *testing.T) {
	t.Parallel()

	if got := averageFloats([]float64{1, 2}); got != 1.5 {
		t.Fatalf("expected average 1.5, got %v", got)
	}
	if got := averageFloats([]float64{1, 2, 2}); got != 1.667 {
		t.Fatalf("expected rounded average 1.667, got %v", got)
	}
	if got := averageFloats(nil); got != 0 {
		t.Fatalf("expected empty average 0, got %v", got)
	}
}

func TestTopLogItemsSortsByCountThenNameAndLimits(t *testing.T) {
	t.Parallel()

	items := topLogItems(map[string]int{
		"delete": 2,
		"build":  3,
		"cancel": 3,
	}, 2)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0].Name != "build" || items[0].Count != 3 {
		t.Fatalf("unexpected first item: %#v", items[0])
	}
	if items[1].Name != "cancel" || items[1].Count != 3 {
		t.Fatalf("unexpected second item: %#v", items[1])
	}
}
