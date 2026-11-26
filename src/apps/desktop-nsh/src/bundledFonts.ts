import base from "../assets/fonts/harmonyos-sans/HarmonyOS_Sans.ttf";
import simplifiedChinese from "../assets/fonts/harmonyos-sans/HarmonyOS_Sans_SC.ttf";
import "../assets/fonts/fira-code/FiraCode-Regular.woff2";
import "../assets/fonts/fira-code/FiraCode-Medium.woff2";
import "../assets/fonts/fira-code/FiraCode-SemiBold.woff2";
import { installBundledUiFonts } from "../../../nsh-ui/src/theme";

installBundledUiFonts({ base, simplifiedChinese });
