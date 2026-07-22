import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const adapterSource = await readFile(new URL("../content_x_adapter.js", import.meta.url), "utf8");

test("player actions keep the status id when the X modal has no enclosing tweet", () => {
  class FakeElement {
    constructor(closest = {}) {
      this.closestResults = closest;
    }

    closest(selector) {
      return this.closestResults[selector] || null;
    }
  }

  const player = new FakeElement();
  const button = new FakeElement({ '[data-testid="videoPlayer"]': player });
  const context = {
    Element: FakeElement,
    URL,
    document: {
      querySelectorAll() {
        return [];
      }
    },
    location: {
      hostname: "x.com",
      href: "https://x.com/garyvee/status/2079710318939291817/video/2",
      pathname: "/garyvee/status/2079710318939291817/video/2"
    }
  };
  context.globalThis = context;
  vm.runInNewContext(adapterSource, context);

  const adapter = context.XVDL_SITE_ADAPTER_FACTORIES[0]({});
  const meta = adapter.getButtonContext(button);

  assert.equal(meta.itemId, "x:2079710318939291817");
  assert.equal(meta.itemUrl, "https://x.com/i/web/status/2079710318939291817");
  assert.equal(meta.platform, "x");
});
