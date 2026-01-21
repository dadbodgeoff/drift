/**
 * ASP.NET Core Security Detectors
 *
 * C#-specific security pattern detectors.
 */

export {
  InputValidationDetector,
  createInputValidationDetector,
  type InputValidationPatternInfo,
  type InputValidationAnalysis,
} from './input-validation-detector.js';
