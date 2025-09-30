# Svelte Functions that Touch the DOM (73 total)

**⚠️ REFERENCE ONLY** - This analysis was not used in the final implementation. The DOM-Only approach (Approach 5 from dom-cover.md) was chosen instead, which shims 60 DOM APIs directly rather than implementing these 73 Svelte AST functions.

## DOM Creation & Manipulation

1. $.from_html - uses document.createElement('template'), document.importNode, node.cloneNode
2. $.from_svg - uses document.createDocumentFragment, document.createElement
3. $.from_mathml - uses document.createDocumentFragment, document.createElement
4. $.from_tree - uses document.createElement, document.createTextNode, document.createComment
5. $.append - uses anchor.before()
6. $.append_styles - appends style elements to DOM
7. $.child - uses node.firstChild, node.appendChild, node.before
8. $.first_child - uses node.firstChild
9. $.sibling - uses node.nextSibling, node.after, node.before
10. $.text - uses document.createTextNode, node.before
11. $.comment - uses document.createComment, document.createDocumentFragment
12. $.element - creates elements (delegates to other functions)
13. $.component - mounts components to DOM
14. $.remove_input_defaults - uses element.hasAttribute, element.removeAttribute
15. $.remove_textarea_child - removes textarea children
16. $.hydrate_template - hydration DOM walking
17. $.next - hydration DOM traversal
18. $.reset - hydration reset
19. $.with_script - uses document.createElement('script'), script.replaceWith

## Attribute & Style Management

20. $.set_attribute - uses element.setAttribute, element.removeAttribute
21. $.set_xlink_attribute - uses element.setAttributeNS
22. $.attribute_effect - manages attributes via set_attribute
23. $.set_class - uses element.className, element.classList.toggle, element.setAttribute
24. $.set_style - uses element.style.cssText, element.style.setProperty, element.style.removeProperty
25. $.set_custom_element_data - sets element properties/attributes
26. $.set_value - sets element.value
27. $.set_checked - sets element.checked
28. $.set_selected - uses element.setAttribute('selected'), element.removeAttribute('selected')
29. $.set_default_value - sets element.defaultValue
30. $.set_default_checked - sets element.defaultChecked
31. $.set_text - sets element.nodeValue

## Event Handling

32. $.event - uses element.addEventListener, element.removeEventListener
33. $.delegate - event delegation setup
34. $.apply - event handler application
35. $.replay_events - uses element.removeAttribute, element.dispatchEvent
36. $.bubble_event - event bubbling
37. $.add_legacy_event_listener - adds event listeners
38. $.once - one-time event setup
39. $.autofocus - uses element.focus()

## Form & Input Bindings

40. $.bind_value - accesses input.value, input.defaultValue, input.selectionStart/End
41. $.bind_checked - accesses input.checked
42. $.bind_files - accesses input.files
43. $.bind_group - manages grouped inputs
44. $.bind_select_value - accesses select.value, select.options
45. $.select_option - sets option.selected
46. $.init_select - initializes select elements
47. $.bind_content_editable - accesses contentEditable properties
48. $.bind_property - binds to element properties
49. $.bind_focused - uses document.activeElement
50. $.bind_this - stores element reference

## Size & Resize Bindings

51. $.bind_element_size - uses ResizeObserver, element.getBoundingClientRect
52. $.bind_resize_observer - uses ResizeObserver

## Window & Document Bindings

53. $.bind_window_scroll - uses window.scrollX/Y, window.scrollTo
54. $.bind_window_size - uses window.innerWidth/Height, outerWidth/Height
55. $.bind_active_element - uses document.activeElement
56. $.bind_online - uses navigator.onLine

## Media Element Bindings

57. $.bind_muted - accesses media.muted
58. $.bind_paused - accesses media.paused
59. $.bind_volume - accesses media.volume
60. $.bind_playback_rate - accesses media.playbackRate
61. $.bind_current_time - accesses media.currentTime
62. $.bind_buffered - accesses media.buffered
63. $.bind_played - accesses media.played
64. $.bind_seekable - accesses media.seekable
65. $.bind_seeking - accesses media.seeking
66. $.bind_ended - accesses media.ended
67. $.bind_ready_state - accesses media.readyState

## Animation & Transitions

68. $.animation - uses element.animate, getComputedStyle
69. $.transition - manages CSS transitions

## Special Elements

70. $.head - manipulates document.head
71. $.html - sets innerHTML
72. $.document - references document object
73. $.window - references window object
