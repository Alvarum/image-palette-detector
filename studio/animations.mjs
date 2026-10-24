/** Short, opt-out visual feedback. Extraction never depends on animation. */

import { gsap } from "gsap";
import { animate } from "motion/mini";
import { spring, stagger } from "motion";

export function initializeAnimations() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const gsapMedia = gsap.matchMedia();
  let current = null;

  // GSAP owns only the one-time page entrance and never palette data.
  gsapMedia.add("(prefers-reduced-motion: no-preference)", () => {
    const items = document.querySelectorAll(
      ".intro, .sidebar, .image-card, .palette-card"
    );
    gsap.fromTo(items,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1, y: 0, duration: 0.56, stagger: 0.07,
        ease: "power2.out", clearProps: "all",
      }
    );
  });

  // Motion's browser engine animates up to 36 swatches, not 200,000.
  document.addEventListener("palette:rendered", () => {
    if (current) current.cancel();
    if (prefersReduced.matches) return;
    const visible = [...document.querySelectorAll(".swatch")].slice(0, 36);
    if (!visible.length) return;
    current = animate(
      visible,
      { opacity: [0, 1], transform: ["translateY(7px)", "translateY(0px)"] },
      { duration: 0.25, delay: stagger(0.014), ease: "easeOut" }
    );
  });

  document.addEventListener("palette:selection", (event) => {
    if (prefersReduced.matches || !event.detail?.target) return;
    animate(event.detail.target,
      { transform: ["scale(0.96)", "scale(1)"] },
      { type: spring, stiffness: 450, damping: 30 }
    );
  });

  // Clean up on navigation, also useful when embedded in another app.
  window.addEventListener("pagehide", () => {
    if (current) current.cancel();
    gsapMedia.revert();
  }, { once: true });
}
