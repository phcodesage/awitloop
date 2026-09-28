import "./styles/app.css";
import { isRoomCode } from "../shared/protocol";
import { initTheme } from "./lib/ui";
import { Host } from "./pages/host";
import { Landing } from "./pages/landing";
import { Remote } from "./pages/remote";
import { Stage, StageBoot } from "./pages/stage";

initTheme();

const root = document.getElementById("app")!;
const parts = location.pathname.split("/").filter(Boolean);
const [section, rawCode] = parts;
const code = (rawCode || "").toUpperCase();

if (section === "tv" && !rawCode) StageBoot(root);
else if (section === "tv" && isRoomCode(code)) Stage(root, code);
else if (section === "r" && isRoomCode(code)) Host(root, code);
else if (section === "m" && isRoomCode(code)) Remote(root, code);
// Short join links: awitloop.pages.dev/CN3UT
else if (section && !rawCode && isRoomCode(section.toUpperCase())) Remote(root, section.toUpperCase());
else Landing(root);
