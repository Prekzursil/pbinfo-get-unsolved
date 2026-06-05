````markdown
# pbinfo-get-unsolved Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns and conventions used in the `pbinfo-get-unsolved` TypeScript repository. It covers file and code organization, commit message standards, import/export styles, and testing patterns. By following these guidelines, contributors can maintain consistency and quality across the codebase.

## Coding Conventions

### File Naming

- Use **camelCase** for file names.
  - Example: `getUnsolvedProblems.ts`

### Import Style

- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { fetchProblems } from './fetchProblems';
    ```

### Export Style

- Use **named exports** instead of default exports.
  - Example:

    ```typescript
    // In fetchProblems.ts
    export function fetchProblems() { ... }

    // In another file
    import { fetchProblems } from './fetchProblems';
    ```

### Commit Messages

- Follow the **conventional commit** format.
- Use prefixes such as `style` to indicate the type of change.
  - Example:
    ```
    style: improve variable naming for clarity in getUnsolvedProblems
    ```

## Workflows

### Style Commit Workflow

**Trigger:** When making stylistic changes (e.g., renaming variables, reformatting code)
**Command:** `/style-commit`

1. Make your stylistic changes in the codebase.
2. Stage the changes using `git add`.
3. Commit with a message starting with `style:`, following the conventional commit format.
   - Example:
     ```
     git commit -m "style: update function names for consistency"
     ```
4. Push your changes to the repository.

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `getUnsolvedProblems.test.ts`).
- The testing framework is **unknown**; check existing test files for structure and assertions.
- Place test files alongside the modules they test or in a dedicated test directory.
- Example test file structure:

  ```typescript
  import { getUnsolvedProblems } from './getUnsolvedProblems';

  describe('getUnsolvedProblems', () => {
    it('should return unsolved problems for a user', () => {
      // test implementation
    });
  });
  ```
````

## Commands

| Command       | Purpose                                    |
| ------------- | ------------------------------------------ |
| /style-commit | Use when committing stylistic code changes |

```

```
