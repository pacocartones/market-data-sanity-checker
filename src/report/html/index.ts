/**
 * Public entry point of the HTML report renderer.
 * Implementation lives in ./check, ./compare and ./shared; this module keeps
 * the stable import path ('../report/html') for the CLI, the library index
 * and the tests.
 */

export { renderCheckHtml } from './check'
export { renderCompareHtml } from './compare'
export { MDSC_VERSION } from './shared'
