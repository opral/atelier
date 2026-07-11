# Notion vs. Atelier Markdown design review

## Scope

Comparison of the supplied Notion document screenshot with Atelier's rendered Markdown, focused on document typography and fenced code blocks.

## Verdict

Notion feels more polished because it gives the text more visual authority and removes nearly all competing decoration. Atelier currently makes the document text slightly small and dense while making the code-block container, syntax palette, and language label comparatively loud.

## Findings

1. **Body typography — needs refinement**
   - Atelier renders body text at 15px with a 25.8px line height (1.72) and negative letter spacing.
   - The small glyphs plus generous leading make paragraphs feel simultaneously compressed and loose.
   - Notion's reference appears fuller and calmer: larger glyphs, neutral tracking, and less contrast between text styles.

2. **Heading typography — mostly healthy, slightly over-weighted**
   - Atelier's H2 is 23px at weight 720 with tight tracking.
   - This looks heavier and more engineered than Notion's quieter editorial hierarchy.
   - Fractional font weights can also render differently across platforms when the chosen system font is not variable.

3. **Code typography — needs refinement**
   - Atelier's code is 13.5px against 15px body text, so code reads as secondary content.
   - The 1.65 code line height is roomy relative to its small glyph size.
   - Several token categories are bold and strongly colored, producing a busy, IDE-like result.

4. **Code-block surface — too much chrome**
   - Atelier combines a border, inset highlight, drop shadow, tinted background, and persistent language label.
   - Notion uses a broad, soft surface with almost no visible edge treatment, keeping attention on the code.
   - Atelier's 34.4px top padding creates dead space primarily to accommodate the label.

5. **Language label — weak and inaccessible**
   - The label is 10px, bold, monospaced, uppercase, and tracked out by 0.9px.
   - It looks like metadata placed after the component was designed rather than part of a deliberate header.
   - It is generated with a CSS pseudo-element, so it is not reliably exposed to assistive technology.

## Recommended direction

- Raise document text to 16px, remove negative body tracking, and use roughly 1.58–1.62 line height.
- Use a softer primary text color and standard 600/700 heading weights.
- Raise code to 14.5–15px with roughly 1.5–1.55 line height.
- Remove the code-block shadow and inset highlight; retain a soft neutral fill with either no border or a barely visible border.
- Reduce syntax highlighting to a restrained three-role palette: keyword, string/value, and comment. Avoid bolding most identifiers and types.
- Hide language metadata in passive reading state. On hover/focus, show a small sans-serif control using full names such as “TypeScript” and “JSON”, paired with a copy action if desired.
- Render language metadata as real DOM content with an accessible label rather than generated CSS content.

## Evidence limits

The screenshots use different content, crop, and scale, so the comparison supports hierarchy and styling recommendations rather than pixel-perfect measurements. Keyboard behavior, zoom reflow, screen-reader output, and syntax-color contrast still require direct testing.
