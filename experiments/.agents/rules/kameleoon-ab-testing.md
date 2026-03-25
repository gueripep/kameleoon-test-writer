---
trigger: always_on
---

# Kameleoon A/B Test Coding Standards

When developing A/B test modifications for clients using Kameleoon, strictly adhere to the following rules:

## General Principles
- **Modern ES6 Syntax**: Always use modern ES6 Javascript features (arrow functions, template literals, destructuring, etc.).
- **Selector Declaration**: Provide all CSS selectors you will use at the very start of the Javascript file for clarity and maintainability.
- **Selector Quality**: Use specific, robust selectors (avoid long chains of `:nth-child` or unstable dynamically generated classes).
- **Scope Focus**: Ignore segments, triggers, and goals. Your task is solely to develop the website's modifications.
- **Visual Accuracy**: Modifications must be as close as possible to the provided design images/documents. Always use the EXACT colors specified.

## Mandatory Kameleoon API Methods
Do NOT use native browser functions for element selection, timeouts, or event listeners. Always use the equivalent Kameleoon API methods:

### 1. Element Selection & Waiting
- **Prohibited**: `document.querySelector()`, `document.querySelectorAll()`, `document.getElementById()`, etc.
- **Mandatory**: `Kameleoon.API.Core.runWhenElementPresent(selector, callback)`.
- **Usage**:
  ```javascript
  Kameleoon.API.Core.runWhenElementPresent("#bloc-2345", (elements) => {
      elements[0].innerText = "My new Text";
  });
  ```

### 2. Timeouts
- **Prohibited**: `setTimeout()`.
- **Mandatory**: `Kameleoon.API.Utils.setTimeout(callback, delay)`.
- **Usage**:
  ```javascript
  const myTimeout = Kameleoon.API.Utils.setTimeout(() => {
   Kameleoon.API.Events.Trigger("5 seconds elapsed");
  }, 5000);
  ```

### 3. Event Listeners
- **Prohibited**: `element.addEventListener()`.
- **Mandatory**: `Kameleoon.API.Utils.addEventListener(element, event, callback)`.
- **Usage**:
  ```javascript
  // After creating/selecting an element
  Kameleoon.API.Utils.addEventListener(popin, "mousedown", function (event) {
   document.body.removeChild(popin);
  });
  ```

## File Structure
The code consists of two files:
1. **Javascript File**: Contains the logic and element modifications using the above API methods.
2. **CSS File**: Use this for all styling changes. It is injected automatically.