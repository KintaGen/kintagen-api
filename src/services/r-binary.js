// src/services/r-binary.js
// Resolve the Rscript binary name/path. In CI/tests we fake R, so this
// file only needs to exist to satisfy imports.
export const RSCRIPT = process.env.RSCRIPT || 'Rscript';
