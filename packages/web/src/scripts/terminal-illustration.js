// Dependency-free ambient illustration player. Unlike the full story player,
// this has no chrome (no window frame, caption, or controls): it recolors a
// recorded terminal-cell animation into a single ink color by luminance and
// paints it directly on the host background, looping indefinitely.
;(function () {
  "use strict"

  var storyRequests = Object.create(null)

  function escapeHtml(value) {
    return value.replace(/[&<>]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character]
    })
  }

  function luminance(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255
    var g = parseInt(hex.slice(3, 5), 16) / 255
    var b = parseInt(hex.slice(5, 7), 16) / 255
    return 0.299 * r + 0.587 * g + 0.114 * b
  }

  function toRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  }

  // Parses a computed "rgb(r, g, b)" / "rgba(r, g, b, a)" color string.
  function parseComputedColor(value) {
    var match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value || "")
    if (!match) return [29, 78, 216]
    return [Math.round(+match[1]), Math.round(+match[2]), Math.round(+match[3])]
  }

  function mix(a, b, t) {
    return Math.round(a + (b - a) * t)
  }

  function runHtml(run, opts) {
    if (!run.f) return escapeHtml(run.t)
    var eased = Math.pow(luminance(run.f), opts.gamma)
    var alpha = opts.minAlpha + eased * (opts.maxAlpha - opts.minAlpha)
    var r = mix(opts.shadow[0], opts.highlight[0], eased)
    var g = mix(opts.shadow[1], opts.highlight[1], eased)
    var b = mix(opts.shadow[2], opts.highlight[2], eased)
    var style = "color:rgb(" + r + "," + g + "," + b + ");opacity:" + alpha.toFixed(3)
    return '<span style="' + style + '">' + escapeHtml(run.t) + "</span>"
  }

  function frameHtml(frame, cacheKey, opts) {
    if (!frame.__html) frame.__html = Object.create(null)
    if (frame.__html[cacheKey] === undefined) {
      frame.__html[cacheKey] = frame.rows
        .map(function (row) {
          return (
            '<span class="terminal-illustration__row">' +
            row
              .map(function (run) {
                return runHtml(run, opts)
              })
              .join("") +
            "</span>"
          )
        })
        .join("")
    }
    return frame.__html[cacheKey]
  }

  // "contain" shrinks a fixed `cols x rows` character grid to fit inside `box`
  // so the whole recording stays visible. "cover" instead holds a comfortable,
  // fixed dot size (so small-glyph texture never shrinks below legibility) and
  // lets the box crop the overflow, centered.
  function fitScreenToBox(screen, box, cols, rows, fit, naturalFontSize) {
    if (fit === "cover") {
      screen.style.fontSize = naturalFontSize + "px"
      return
    }

    var probe = document.createElement("span")
    probe.style.cssText = "position:absolute;visibility:hidden;font-size:100px;width:1ch;display:block;"
    probe.style.fontFamily = getComputedStyle(screen).fontFamily
    document.body.appendChild(probe)
    var chToEm = probe.getBoundingClientRect().width / 100
    probe.remove()
    if (!chToEm) return

    var lineToEm = 1.5

    function apply() {
      var rect = box.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      var fromWidth = rect.width / (cols * chToEm)
      var fromHeight = rect.height / (rows * lineToEm)
      var fontSize = Math.min(fromWidth, fromHeight)
      screen.style.fontSize = Math.max(1, Math.floor(fontSize)) + "px"
    }

    apply()
    if ("ResizeObserver" in window) new ResizeObserver(apply).observe(box)
    else window.addEventListener("resize", apply)
  }

  function flattenFrames(story) {
    var frames = []
    var offset = 0
    story.chapters.forEach(function (chapter) {
      chapter.frames.forEach(function (frame) {
        frames.push({ at: offset + frame.at, rows: frame.rows })
      })
      var lastAt = chapter.frames.length ? chapter.frames[chapter.frames.length - 1].at : 0
      offset += Math.max(chapter.durationMs || 0, lastAt) + (chapter.holdMs || 0)
    })
    return { frames: frames, totalDurationMs: offset }
  }

  function mount(illustration, story) {
    var screen = illustration.querySelector("[data-illustration-screen]")
    if (!screen) return

    var gamma = parseFloat(illustration.getAttribute("data-illustration-gamma")) || 2.2
    var minAlpha = parseFloat(illustration.getAttribute("data-illustration-min-alpha"))
    if (Number.isNaN(minAlpha)) minAlpha = 0.02
    var maxAlpha = parseFloat(illustration.getAttribute("data-illustration-max-alpha"))
    if (Number.isNaN(maxAlpha)) maxAlpha = 1
    var brandInk = parseComputedColor(getComputedStyle(illustration).color)
    var inkShadowAttr = illustration.getAttribute("data-illustration-ink-shadow")
    var inkHighlightAttr = illustration.getAttribute("data-illustration-ink-highlight")
    var inkShadow = inkShadowAttr ? toRgb(inkShadowAttr) : brandInk
    var inkHighlight = inkHighlightAttr ? toRgb(inkHighlightAttr) : brandInk
    var cacheKey = gamma + ":" + minAlpha + ":" + maxAlpha + ":" + inkShadow.join(",") + ":" + inkHighlight.join(",")
    var paintOpts = { gamma: gamma, minAlpha: minAlpha, maxAlpha: maxAlpha, shadow: inkShadow, highlight: inkHighlight }
    var fit = illustration.getAttribute("data-illustration-fit") || "contain"
    var naturalFontSize = parseFloat(illustration.getAttribute("data-illustration-font-size")) || 14
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

    var timeline = flattenFrames(story)
    var frames = timeline.frames
    if (!frames.length) return

    var frameIndex = 0
    var elapsed = 0
    var lastTick = 0
    var animationFrame = 0
    var isIntersecting = false
    var playing = false

    fitScreenToBox(screen, illustration, story.cols, story.rows, fit, naturalFontSize)

    function paint() {
      screen.innerHTML = frameHtml(frames[frameIndex], cacheKey, paintOpts)
    }

    if (reduceMotion) {
      frameIndex = Math.floor(frames.length / 2)
      paint()
      return
    }

    function tick(now) {
      if (!playing) return
      elapsed += Math.min(now - lastTick, 100)
      lastTick = now

      if (elapsed >= timeline.totalDurationMs) {
        elapsed = 0
        frameIndex = 0
        paint()
      } else {
        while (frameIndex + 1 < frames.length && frames[frameIndex + 1].at <= elapsed) {
          frameIndex += 1
        }
        paint()
      }

      animationFrame = window.requestAnimationFrame(tick)
    }

    function play() {
      if (playing) return
      playing = true
      lastTick = performance.now()
      animationFrame = window.requestAnimationFrame(tick)
    }

    function pause() {
      playing = false
      window.cancelAnimationFrame(animationFrame)
    }

    paint()

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause()
      else if (isIntersecting) play()
    })

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          isIntersecting = entries.some(function (entry) {
            return entry.isIntersecting
          })
          if (isIntersecting && !document.hidden) play()
          else pause()
        },
        { threshold: 0.1 },
      ).observe(illustration)
    } else {
      isIntersecting = true
      play()
    }
  }

  function loadStory(source) {
    if (!storyRequests[source]) {
      storyRequests[source] = fetch(source)
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status)
          return response.json()
        })
        .catch(function (error) {
          delete storyRequests[source]
          throw error
        })
    }
    return storyRequests[source]
  }

  document.querySelectorAll("[data-terminal-illustration]").forEach(function (illustration) {
    var source = illustration.getAttribute("data-terminal-illustration") || "/recordings/terminal-story.json"
    loadStory(source).then(function (story) {
      mount(illustration, story)
    })
  })
})()
