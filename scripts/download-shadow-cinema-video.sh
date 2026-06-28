#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OUTPUT_DIR="/home/simon/capture/opentui-visualizer"
DIRECT_FORMAT="bv[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]"
FALLBACK_FORMAT="bv+ba/b"

output_dir="${SHADOW_CINEMA_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
output_name=""
force="0"
urls=()

usage() {
  printf '%s\n' \
    "Usage: $0 [options] <youtube-url> [youtube-url ...]" \
    "" \
    "Downloads videos as H.264/AAC MP4 files compatible with shadow-cinema-spike.ts." \
    "By default, the output file name is the normalized YouTube video title." \
    "" \
    "Options:" \
    "  -o, --output-dir <dir>  Output directory. Default: $DEFAULT_OUTPUT_DIR" \
    "  -n, --name <name>       Custom output base name. Normalized too. Only valid with one URL." \
    "  -f, --force             Overwrite an existing output file." \
    "  -h, --help              Show this help." \
    "" \
    "Examples:" \
    "  $0 'https://www.youtube.com/watch?v=vDXSs4xQLu8'" \
    "  $0 --name my-video 'https://www.youtube.com/watch?v=vDXSs4xQLu8'" \
    "  SHADOW_CINEMA_OUTPUT_DIR=/tmp/videos $0 'https://www.youtube.com/watch?v=vDXSs4xQLu8'"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found in PATH"
}

sanitize_title() {
  local value="$1"

  if command -v iconv >/dev/null 2>&1; then
    value="$(printf '%s' "$value" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$value")"
  fi

  value="$(printf '%s' "$value" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C tr -c 'a-z0-9' '-')"
  while [[ "$value" == *"--"* ]]; do
    value="${value//--/-}"
  done
  value="${value#"${value%%[!-]*}"}"
  value="${value%"${value##*[!-]}"}"

  if [[ ${#value} -gt 180 ]]; then
    value="${value:0:180}"
    value="${value%"${value##*[!-]}"}"
  fi

  printf '%s\n' "$value"
}

escape_output_template() {
  local value="$1"

  printf '%s\n' "${value//%/%%}"
}

is_compatible() {
  local file="$1"
  local video_codec audio_codec

  video_codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null || true)"
  audio_codec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null || true)"

  [[ "$video_codec" == "h264" && "$audio_codec" == "aac" ]]
}

print_summary() {
  local file="$1"

  printf '\nVerified %s\n' "$file"
  ffprobe -v error \
    -show_entries stream=index,codec_type,codec_name,codec_tag_string,width,height,sample_rate,channels \
    -show_entries format=format_name,duration,size \
    -of default=noprint_wrappers=1 \
    "$file"
}

find_downloaded_file() {
  local tmp_dir="$1"
  local candidate

  for candidate in "$tmp_dir"/source.*; do
    if [[ -f "$candidate" && "$candidate" != *.part && "$candidate" != *.ytdl ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

transcode_to_compatible_mp4() {
  local source_file="$1"
  local output_file="$2"
  local tmp_output="${output_file%.mp4}.tmp.mp4"

  ffmpeg -y -i "$source_file" \
    -map 0:v:0 -map 0:a:0 \
    -c:v libx264 -pix_fmt yuv420p \
    -c:a aac -b:a 192k \
    -movflags +faststart \
    "$tmp_output"

  mv "$tmp_output" "$output_file"
}

download_one() {
  local url="$1"
  local metadata video_id video_title base template_base output_file template tmp_dir source_file
  local overwrite_args=()

  metadata="$(yt-dlp --no-playlist --skip-download --print '%(id)s' --print '%(title)s' "$url")"
  video_id="${metadata%%$'\n'*}"
  video_title="${metadata#*$'\n'}"
  [[ -n "$video_id" ]] || die "Could not determine video id for $url"

  if [[ -n "$output_name" ]]; then
    base="$(sanitize_title "$output_name")"
    [[ -n "$base" ]] || die "--name normalizes to an empty filename"
  else
    base="$(sanitize_title "$video_title")"
    [[ -n "$base" ]] || base="shadow-cinema-$video_id"
  fi

  template_base="$(escape_output_template "$base")"
  output_file="$output_dir/$base.mp4"
  template="$output_dir/$template_base.%(ext)s"

  if [[ -e "$output_file" && "$force" != "1" ]]; then
    is_compatible "$output_file" || die "$output_file already exists but is not H.264/AAC. Use --force to replace it."
    printf 'Already compatible: %s\n' "$output_file"
    print_summary "$output_file"
    return 0
  fi

  if [[ "$force" == "1" ]]; then
    overwrite_args+=(--force-overwrites)
    rm -f "$output_file"
  fi

  printf '\nDownloading %s\n' "$url"
  printf 'Output: %s\n' "$output_file"

  if yt-dlp -f "$DIRECT_FORMAT" --merge-output-format mp4 --no-playlist "${overwrite_args[@]}" -o "$template" "$url"; then
    if is_compatible "$output_file"; then
      print_summary "$output_file"
      return 0
    fi

    printf 'Direct download was not compatible; transcoding downloaded file.\n'
    transcode_to_compatible_mp4 "$output_file" "$output_file"
    is_compatible "$output_file" || die "Transcoded file is still not H.264/AAC: $output_file"
    print_summary "$output_file"
    return 0
  fi

  printf 'Direct H.264/AAC download was not available; downloading best source and transcoding.\n'
  tmp_dir="$(mktemp -d)"

  if ! yt-dlp -f "$FALLBACK_FORMAT" --no-playlist -o "$tmp_dir/source.%(ext)s" "$url"; then
    rm -rf "$tmp_dir"
    die "Fallback download failed for $url"
  fi

  source_file="$(find_downloaded_file "$tmp_dir")" || {
    rm -rf "$tmp_dir"
    die "Could not locate fallback download for $url"
  }

  transcode_to_compatible_mp4 "$source_file" "$output_file"
  rm -rf "$tmp_dir"

  is_compatible "$output_file" || die "Downloaded file is not H.264/AAC: $output_file"
  print_summary "$output_file"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o | --output-dir)
      option="$1"
      shift
      [[ $# -gt 0 ]] || die "$option requires a directory"
      output_dir="$1"
      ;;
    -n | --name)
      option="$1"
      shift
      [[ $# -gt 0 ]] || die "$option requires a name"
      output_name="$1"
      ;;
    -f | --force)
      force="1"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        urls+=("$1")
        shift
      done
      break
      ;;
    -*)
      die "Unknown option: $1"
      ;;
    *)
      urls+=("$1")
      ;;
  esac
  shift
done

[[ ${#urls[@]} -gt 0 ]] || {
  usage
  exit 1
}

if [[ -n "$output_name" && ${#urls[@]} -gt 1 ]]; then
  die "--name can only be used with one URL"
fi

require_command yt-dlp
require_command ffmpeg
require_command ffprobe

mkdir -p "$output_dir"

for url in "${urls[@]}"; do
  download_one "$url"
done
