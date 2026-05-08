package graph

import (
	"path"
	"strings"
)

var imageKeys = []string{"images", "image", "imageUrl", "图片", "图像", "照片"}
var videoKeys = []string{"videos", "video", "videoUrl", "视频", "影片"}
var audioKeys = []string{"audios", "audio", "audioUrl", "音频", "音乐", "声音"}

func buildMediaFromProperties(properties map[string]interface{}) map[string][]MediaResource {
	images := collectMediaValues(properties, imageKeys)
	videos := collectMediaValues(properties, videoKeys)
	audios := collectMediaValues(properties, audioKeys)

	return map[string][]MediaResource{
		"images": toImageResources(images),
		"videos": toVideoResources(videos),
		"audios": toAudioResources(audios),
	}
}

func collectMediaValues(properties map[string]interface{}, keys []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, 8)
	for _, key := range keys {
		value, exists := properties[key]
		if !exists || value == nil {
			continue
		}
		for _, item := range flattenMediaValues(value) {
			trimmed := strings.TrimSpace(item)
			if trimmed == "" {
				continue
			}
			if _, ok := seen[trimmed]; ok {
				continue
			}
			seen[trimmed] = struct{}{}
			result = append(result, trimmed)
		}
	}
	return result
}

func flattenMediaValues(value interface{}) []string {
	switch v := value.(type) {
	case string:
		return []string{v}
	case []string:
		return v
	case []interface{}:
		items := make([]string, 0, len(v))
		for _, item := range v {
			items = append(items, flattenMediaValues(item)...)
		}
		return items
	default:
		return nil
	}
}

func toImageResources(items []string) []MediaResource {
	resources := make([]MediaResource, 0, len(items))
	for _, item := range items {
		if isURL(item) {
			resources = append(resources, MediaResource{
				Filename:  fileNameFromPath(item),
				URL:       item,
				Thumbnail: item,
			})
			continue
		}

		url := "/api/media/" + item
		resources = append(resources, MediaResource{
			Filename:  fileNameFromPath(item),
			URL:       url,
			Thumbnail: url,
		})
	}
	return resources
}

func toVideoResources(items []string) []MediaResource {
	resources := make([]MediaResource, 0, len(items))
	for _, item := range items {
		if isURL(item) {
			resources = append(resources, MediaResource{
				Filename:  fileNameFromPath(item),
				URL:       item,
				Thumbnail: item,
			})
			continue
		}
		resources = append(resources, MediaResource{
			Filename:  fileNameFromPath(item),
			URL:       "/api/media/" + item,
			Thumbnail: "/api/media/" + trimExt(item) + "_thumb.jpg",
		})
	}
	return resources
}

func toAudioResources(items []string) []MediaResource {
	resources := make([]MediaResource, 0, len(items))
	for _, item := range items {
		if isURL(item) {
			resources = append(resources, MediaResource{
				Filename: fileNameFromPath(item),
				URL:      item,
			})
			continue
		}
		resources = append(resources, MediaResource{
			Filename: fileNameFromPath(item),
			URL:      "/api/media/" + item,
		})
	}
	return resources
}

func isURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "ftp://")
}

func fileNameFromPath(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	base := path.Base(trimmed)
	if base == "." || base == "/" {
		return trimmed
	}
	return base
}

func trimExt(value string) string {
	dot := strings.LastIndex(value, ".")
	if dot <= 0 {
		return value
	}
	return value[:dot]
}
