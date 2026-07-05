// Side-effect import for process entrypoints: anchors MENTIKO_CODE_ROOT from
// this module's on-disk location BEFORE @/lib/config is evaluated anywhere in
// the import graph. Import this FIRST in any runner-v2 entry script.
import { anchorCodeRootEnv } from "@/lib/runner-v2/entry-code-root";

anchorCodeRootEnv(__dirname);
