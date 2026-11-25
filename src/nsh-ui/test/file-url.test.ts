// Local paths become `file:` URLs that name the same file on macOS, Linux and Windows.
import { expect, test } from "nsh/test";
import { fileUrlOfPath, pathOfFileUrl } from "../src/attachmentStore";

test("local paths and file: URLs round-trip on every OS", () => {
  expect(fileUrlOfPath("/Users/me/a b.png")).toBe("file:///Users/me/a b.png");
  expect(fileUrlOfPath("C:\\Users\\me\\shot.png")).toBe("file:///C:/Users/me/shot.png");
  expect(fileUrlOfPath("D:/work/x.png")).toBe("file:///D:/work/x.png");
  expect(fileUrlOfPath("\\\\srv\\share\\x.png")).toBe("file://srv/share/x.png");
  expect(fileUrlOfPath("file:///already.png")).toBe("file:///already.png");
  expect(pathOfFileUrl("file:///C:/Users/me/shot.png")).toBe("C:/Users/me/shot.png");
  expect(pathOfFileUrl("file://srv/share/x.png")).toBe("//srv/share/x.png");
  expect(pathOfFileUrl("file:///Users/me/a%20b.png")).toBe("/Users/me/a b.png");
  expect(pathOfFileUrl("file://localhost/tmp/x.png")).toBe("/tmp/x.png");
  expect(pathOfFileUrl("relative/x.png")).toBe("relative/x.png");
});
