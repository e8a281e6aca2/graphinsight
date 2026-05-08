package graph

import "testing"

func TestBuildMediaFromProperties(t *testing.T) {
	t.Parallel()

	props := map[string]interface{}{
		"images": []interface{}{"a.png", "a.png", " https://example.com/b.jpg "},
		"video":  "demo.mp4",
		"audios": []interface{}{"music.mp3", "music.mp3"},
	}

	media := buildMediaFromProperties(props)

	if len(media["images"]) != 2 {
		t.Fatalf("expected 2 images, got %d", len(media["images"]))
	}
	if media["images"][0].URL != "/api/media/a.png" {
		t.Fatalf("unexpected local image url: %s", media["images"][0].URL)
	}
	if media["images"][1].URL != "https://example.com/b.jpg" {
		t.Fatalf("unexpected remote image url: %s", media["images"][1].URL)
	}
	if media["images"][1].Thumbnail != "https://example.com/b.jpg" {
		t.Fatalf("unexpected remote image thumbnail: %s", media["images"][1].Thumbnail)
	}

	if len(media["videos"]) != 1 {
		t.Fatalf("expected 1 video, got %d", len(media["videos"]))
	}
	if media["videos"][0].Thumbnail != "/api/media/demo_thumb.jpg" {
		t.Fatalf("unexpected video thumbnail: %s", media["videos"][0].Thumbnail)
	}

	if len(media["audios"]) != 1 {
		t.Fatalf("expected 1 audio, got %d", len(media["audios"]))
	}
	if media["audios"][0].URL != "/api/media/music.mp3" {
		t.Fatalf("unexpected audio url: %s", media["audios"][0].URL)
	}
}

func TestBuildMediaFromPropertiesChineseKeys(t *testing.T) {
	t.Parallel()

	props := map[string]interface{}{
		"图片": []interface{}{"图1.png"},
		"视频": "片段.mp4",
		"音频": "播报.wav",
	}

	media := buildMediaFromProperties(props)
	if len(media["images"]) != 1 || media["images"][0].URL != "/api/media/图1.png" {
		t.Fatalf("unexpected chinese image mapping: %+v", media["images"])
	}
	if len(media["videos"]) != 1 || media["videos"][0].URL != "/api/media/片段.mp4" {
		t.Fatalf("unexpected chinese video mapping: %+v", media["videos"])
	}
	if len(media["audios"]) != 1 || media["audios"][0].URL != "/api/media/播报.wav" {
		t.Fatalf("unexpected chinese audio mapping: %+v", media["audios"])
	}
}
