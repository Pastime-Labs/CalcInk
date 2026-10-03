# 16. Visual Design Pass

Status: **planned V1**, after the functional frontend and state model work.
This is a product-design checkpoint, not permission to postpone layout,
accessibility, or clear feedback until the end. Its goal is a coherent
handwriting tool, not a generic dashboard or decorative "AI" veneer.

## Design brief

The paper is the primary work surface. A user should understand where to
write, which page is open, whether an answer is automatic or corrected, and
whether their ink is saved or usable offline without reading a manual.
Tools should recede until needed, while errors and review affordances remain
unmissable. Desktop and phone share a visual language, not necessarily the
same geometry. The prototype's warm paper, graphite ink, teal answers, and
red errors are reference material, **not** an approved final palette.

This pass does not add features, replace the tested data flow, or introduce
network fonts, remote icons, heavy blur/shadow effects, and animations that
compete with drawing responsiveness. Use local font/icon assets or CSS/SVG
already included in the build. Visual polish must not change recognition
input geometry or move answer anchors unpredictably.

## Ordered design-to-build process

1. Inventory every existing functional state with screenshots at phone and
   desktop widths: empty page, ink in progress, result, invalid expression,
   wrong readback/correction, offline setup, save failure, model failure,
   recovery, page list, and deletion confirmation. Mark hierarchy and
   clarity problems before changing color.
2. Define a one-page visual brief: audience, desired feeling, primary action,
   density, reference examples, and explicit anti-patterns. Explore two
   meaningfully different directions using the *same* representative
   screens; choose one by legibility, result provenance, speed, and
   distinctiveness rather than a trendy style label. Record the leader's
   choice and rejected tradeoff.
3. Build a small token sheet: paper/surface/ink/result/error/focus colors,
   type roles, spacing, radii, border/shadow levels, and motion timing. Test
   contrast and focus visibility in every state. Keep critical meaning in
   text/icons as well as color.
4. Apply tokens to the existing functional components and responsive
   layouts. Keep tool and page actions in stable places; make touch targets
   comfortably separated. Use a few purposeful transitions for panel entry
   or result settlement only if they do not delay feedback; disable them
   under reduced motion.
5. Compare before/after screenshots on real phone and desktop, then rerun
   interaction, accessibility, drawing-frame, and offline tests. Remove a
   visual flourish if it causes lag, obscures ink, or increases cognitive
   load.

## Deliverables and exit gate

Keep the chosen brief, token values, representative phone/desktop screens,
and a short rationale alongside implementation evidence. Review an answer
over dense ink, a very long expression, a right-edge projection, and all
warning/error states, not only the empty hero screen. No fabricated "model
confidence" badge; automatic results carry an honest review cue.

Exit when the leader approves a consistent visual system, status and
result provenance remain clear at a glance, and the same functional,
accessibility, and performance gates pass after styling. If time is tight,
ship the clean functional UI rather than a polished screen with unverified
recognition or data loss.
