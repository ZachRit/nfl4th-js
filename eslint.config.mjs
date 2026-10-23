import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // A config object with only `ignores` sets the global ignore list.
  {
    ignores: ['dist/**', 'coverage/**', '**/*.config.*'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
