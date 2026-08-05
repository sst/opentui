// Dependency-free terminal story player. It fetches sampled terminal frames and
// contain-fits their fixed character grid into each player instance.
;(function () {
  "use strict"

  var storyRequests = Object.create(null)

  function escapeHtml(value) {
    return value.replace(/[&<>]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character]
    })
  }

  function runHtml(run, renderForeground, renderBackground) {
    var style = ""
    if (renderForeground && run.f) style += "color:" + run.f + ";"
    if (renderBackground && run.b) style += "background-color:" + run.b + ";"
    if (run.a) {
      if (run.a.indexOf("b") !== -1) style += "font-weight:700;"
      if (run.a.indexOf("i") !== -1) style += "font-style:italic;"
      if (run.a.indexOf("u") !== -1) style += "text-decoration:underline;"
    }
    var text = escapeHtml(run.t)
    return style ? '<span class="terminal-run" style="' + style + '">' + text + "</span>" : text
  }

  function frameHtml(frame, renderForeground, renderBackground) {
    var cacheKey = String(Number(renderForeground)) + String(Number(renderBackground))
    if (!frame.htmlByStyle) frame.htmlByStyle = Object.create(null)
    if (frame.htmlByStyle[cacheKey] === undefined) {
      frame.htmlByStyle[cacheKey] = frame.rows
        .map(function (row) {
          return (
            '<span class="terminal-row">' +
            row
              .map(function (run) {
                return runHtml(run, renderForeground, renderBackground)
              })
              .join("") +
            "</span>"
          )
        })
        .join("")
    }
    return frame.htmlByStyle[cacheKey]
  }

  // Contain-fit a fixed `cols x rows` character grid inside `box`: measures the
  // font's ch-to-em ratio once, then keeps font-size in sync with box size.
  function fitScreenToBox(screen, box, cols, rows) {
    var probe = document.createElement("span")
    probe.style.cssText = "position:absolute;visibility:hidden;font-size:100px;width:1ch;display:block;"
    probe.style.fontFamily = getComputedStyle(screen).fontFamily
    document.body.appendChild(probe)
    var chToEm = probe.getBoundingClientRect().width / 100
    probe.remove()
    if (!chToEm) return

    var lineToEm = 1.5 // matches .terminal-row { line-height: 1.5em }

    function apply() {
      var rect = box.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      var fromWidth = rect.width / (cols * chToEm)
      var fromHeight = rect.height / (rows * lineToEm)
      var fontSize = Math.max(1, Math.floor(Math.min(fromWidth, fromHeight)))
      screen.style.fontSize = fontSize + "px"
    }

    apply()
    if ("ResizeObserver" in window) new ResizeObserver(apply).observe(box)
    else window.addEventListener("resize", apply)
  }

  function mount(player, story) {
    var screen = player.querySelector("[data-player-screen]")
    var screenBox = player.querySelector(".terminal-window__screen")
    var title = player.querySelector("[data-player-title]")
    var dims = player.querySelector("[data-player-dims]")
    var caption = player.querySelector("[data-player-caption]")
    var segments = player.querySelector("[data-player-segments]")
    var toggle = player.querySelector("[data-player-toggle]")
    var toggleLabel = player.querySelector("[data-player-toggle-label]")
    var terminal = player.querySelector(".terminal-window")
    var playerLabel = player.getAttribute("aria-label") || "Terminal demonstration"
    var loop = player.hasAttribute("data-loop")
    var renderBackground = player.getAttribute("data-terminal-background") !== "transparent"
    var renderForeground = player.getAttribute("data-terminal-tone") !== "inherit"
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    var chapters = story.chapters
    var chapterIndex = 0
    var frameIndex = 0
    var elapsed = 0
    var lastTick = 0
    var animationFrame = 0
    var playing = false
    var finished = false
    var hasStarted = false
    var isIntersecting = false
    var resumeAfterIntersection = false
    var resumeAfterVisibility = false
    var observer

    if (!screen || !chapters.length) return

    if (title) title.textContent = story.title
    if (dims) dims.textContent = story.cols + " \u00d7 " + story.rows
    if (screenBox) screenBox.style.backgroundColor = renderBackground ? story.background : "transparent"
    player.style.setProperty("--terminal-columns", story.cols)
    if (renderForeground) screen.style.color = story.foreground
    else screen.style.removeProperty("color")

    if (screenBox) fitScreenToBox(screen, screenBox, story.cols, story.rows)

    function chapterDuration(chapter) {
      var lastFrameAt = chapter.frames.length ? chapter.frames[chapter.frames.length - 1].at : 0
      return Math.max(chapter.durationMs || 0, lastFrameAt) + (chapter.holdMs || 0)
    }

    var buttons =
      chapters.length > 1
        ? chapters.map(function (chapter, index) {
            var button = document.createElement("button")
            button.className = "story-segment"
            button.type = "button"
            button.setAttribute("aria-label", "Show chapter " + (index + 1) + ": " + chapter.label)
            button.style.setProperty("--progress", "0")
            button.innerHTML = '<span class="visually-hidden">' + escapeHtml(chapter.label) + "</span>"
            button.addEventListener("click", function () {
              hasStarted = true
              finished = false
              playing = true
              showChapter(index)
              updateToggle()
              startLoop()
            })
            if (segments) segments.appendChild(button)
            return button
          })
        : []

    function paint() {
      screen.innerHTML = frameHtml(chapters[chapterIndex].frames[frameIndex], renderForeground, renderBackground)
    }

    function renderProgress() {
      if (!buttons.length) return
      var progress = Math.min(elapsed / chapterDuration(chapters[chapterIndex]), 1)
      buttons.forEach(function (button, index) {
        var value = index < chapterIndex ? 1 : index === chapterIndex ? progress : 0
        button.style.setProperty("--progress", String(value))
        if (index === chapterIndex) button.setAttribute("aria-current", "step")
        else button.removeAttribute("aria-current")
      })
    }

    function renderCaption() {
      if (!caption) return
      var chapter = chapters[chapterIndex]
      if (!chapter.captionTitle && !chapter.caption) return
      caption.innerHTML = "<strong>" + escapeHtml(chapter.captionTitle) + ":</strong> " + escapeHtml(chapter.caption)
    }

    function showChapter(index) {
      chapterIndex = index
      elapsed = 0
      lastTick = performance.now()
      frameIndex = reduceMotion ? chapters[index].frames.length - 1 : 0
      paint()
      renderCaption()
      renderProgress()
    }

    function updateToggle() {
      if (!toggle) return
      var state = finished ? "replay" : playing ? "pause" : "play"
      var label = state === "replay" ? "Play again" : state === "pause" ? "Pause" : hasStarted ? "Resume" : "Play"
      toggle.dataset.state = state
      toggle.classList.toggle("is-wide", state === "replay")
      toggle.setAttribute("aria-label", label + " " + playerLabel)
      toggle.setAttribute("aria-pressed", String(playing))
      if (toggleLabel) toggleLabel.textContent = label
    }

    function tick(now) {
      if (!playing) return
      elapsed += Math.min(now - lastTick, 100)
      lastTick = now

      var frames = chapters[chapterIndex].frames
      while (frameIndex + 1 < frames.length && frames[frameIndex + 1].at <= elapsed) {
        frameIndex += 1
        paint()
      }

      if (elapsed >= chapterDuration(chapters[chapterIndex])) {
        if (chapterIndex === chapters.length - 1) {
          if (loop) {
            showChapter(0)
            renderProgress()
            animationFrame = window.requestAnimationFrame(tick)
            return
          }
          playing = false
          finished = true
          renderProgress()
          updateToggle()
          return
        }
        showChapter(chapterIndex + 1)
      }

      renderProgress()
      animationFrame = window.requestAnimationFrame(tick)
    }

    function startLoop() {
      window.cancelAnimationFrame(animationFrame)
      lastTick = performance.now()
      animationFrame = window.requestAnimationFrame(tick)
    }

    function play() {
      if (finished) showChapter(0)
      hasStarted = true
      finished = false
      playing = true
      updateToggle()
      startLoop()
    }

    function pause() {
      playing = false
      window.cancelAnimationFrame(animationFrame)
      updateToggle()
    }

    if (toggle) {
      toggle.addEventListener("click", function () {
        if (playing) {
          resumeAfterIntersection = false
          resumeAfterVisibility = false
          pause()
        } else play()
      })
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        resumeAfterVisibility = playing
        if (playing) pause()
      } else if (resumeAfterVisibility) {
        resumeAfterVisibility = false
        if (isIntersecting) play()
        else resumeAfterIntersection = true
      }
    })

    showChapter(0)
    updateToggle()

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        function (entries) {
          isIntersecting = entries.some(function (entry) {
            return entry.isIntersecting
          })
          if (isIntersecting) {
            if (!hasStarted || resumeAfterIntersection) {
              resumeAfterIntersection = false
              play()
            }
          } else if (playing) {
            resumeAfterIntersection = true
            pause()
          }
        },
        { threshold: 0.35 },
      )
      observer.observe(terminal || player)
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

  document.querySelectorAll("[data-terminal-story]").forEach(function (player) {
    var source = player.getAttribute("data-terminal-story") || "/recordings/terminal-story.json"
    loadStory(source)
      .then(function (story) {
        mount(player, story)
      })
      .catch(function (error) {
        var caption = player.querySelector("[data-player-caption]")
        if (caption) caption.textContent = "Recording unavailable: " + String(error.message || error)
      })
  })
})()
