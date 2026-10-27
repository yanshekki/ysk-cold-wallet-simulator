#!/usr/bin/env node
/**
 * KeyboardProvider's EdgeToEdgeReactViewGroup applies navigation-bar
 * left/right insets as FrameLayout margins on the activity content view.
 * On Android 15 edge-to-edge those insets are already consumed, so the extra
 * margins make every page look left-heavy (kirillzyusko/react-native-keyboard-controller#1488).
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules/react-native-keyboard-controller/android/src/main/java/com/reactnativekeyboardcontroller/views/EdgeToEdgeReactViewGroup.kt',
);

if (!fs.existsSync(file)) {
  process.exit(0);
}

let src = fs.readFileSync(file, 'utf8');
if (src.includes('if (this.isNavigationBarTranslucent) 0 else navBarInsets.left')) {
  process.exit(0);
}

const next = src
  .replace(
    '          navBarInsets.left,\n',
    '          if (this.isNavigationBarTranslucent) 0 else navBarInsets.left,\n',
  )
  .replace(
    '          navBarInsets.right,\n',
    '          if (this.isNavigationBarTranslucent) 0 else navBarInsets.right,\n',
  );

if (next === src) {
  console.warn('keyboard-controller inset patch: expected margin block not found');
  process.exit(0);
}

fs.writeFileSync(file, next);
console.log('patched react-native-keyboard-controller edge-to-edge left/right insets');
