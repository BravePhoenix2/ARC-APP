// Enable React's act integration for the Node renderer tests. Unexpected
// updates outside act still produce React's normal diagnostic warnings.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
