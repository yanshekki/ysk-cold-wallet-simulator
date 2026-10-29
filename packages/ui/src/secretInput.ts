import type { TextInputProps } from 'react-native';

/**
 * System copy and select-all off for fields that hold a seed, share,
 * passphrase, or entropy. Does not write the clipboard. An explicit Paste
 * control may still read it.
 *
 * Spread this first. Masked passphrase fields set `textContentType="oneTimeCode"`
 * afterward so iOS does not offer to save the value as a password.
 */
export const secretInputProps = {
  contextMenuHidden: true,
  selectTextOnFocus: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
  autoCorrect: false,
  spellCheck: false,
  textContentType: 'none',
} as const satisfies Pick<
  TextInputProps,
  | 'contextMenuHidden'
  | 'selectTextOnFocus'
  | 'autoComplete'
  | 'importantForAutofill'
  | 'autoCorrect'
  | 'spellCheck'
  | 'textContentType'
>;
