// DevTools initialization module
// This file is dynamically imported only when DEV=true

import "./devtools-polyfill"

// @ts-expect-error - no types available for react-devtools-core
import devtools from "react-devtools-core"

devtools.initialize()
devtools.connectToDevTools()
