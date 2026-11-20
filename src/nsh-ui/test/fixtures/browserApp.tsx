// The native desktop (wire + NSH shell, as `nativeApp.tsx`) with stand-in web
// views, since the headless test host shows no web pages.
import "./installWire";
import "./installFakeBrowser";
import "../../App";
