import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SubtitleLangPrompt } from "./SubtitleLangPrompt";

// Ink batches stdin handling; give it a tick between writes.
const tick = () => new Promise((r) => setTimeout(r, 0));

function mount() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const instance = render(
    <SubtitleLangPrompt width={40} value="" onSubmit={onSubmit} onCancel={onCancel} />,
  );
  return { instance, onSubmit, onCancel };
}

describe("SubtitleLangPrompt", () => {
  it("submits a valid 2-letter code on enter", async () => {
    const { instance, onSubmit } = mount();
    instance.stdin.write("he");
    await tick();
    instance.stdin.write("\r");
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("he");
  });

  it("does not submit invalid input and shows the error hint", async () => {
    const { instance, onSubmit, onCancel } = mount();
    instance.stdin.write("x1!");
    await tick();
    instance.stdin.write("\r");
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(instance.lastFrame()).toContain("Use a 2-3 letter code");

    // Still mounted and correctable: a single letter is also rejected.
    instance.stdin.write("\x15"); // ctrl+u clears the field
    await tick();
    instance.stdin.write("q");
    await tick();
    instance.stdin.write("\r");
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel on escape", async () => {
    const { instance, onSubmit, onCancel } = mount();
    instance.stdin.write("\x1B");
    // Ink holds a lone ESC ~20ms to see if an escape sequence follows.
    await new Promise((r) => setTimeout(r, 40));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
