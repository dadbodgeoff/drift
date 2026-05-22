import { ParsedArgs } from "../app/command-types.js";

export function unknownCommandError(parsed: ParsedArgs): string | null {
  const [group, command, maybeId] = parsed.positional;
  if (!group) {
    return null;
  }
  const message = `Unknown command: ${parsed.positional.join(" ")}. Run drift --help.`;
  const exact = (commands: Array<string | undefined>): string | null => commands.includes(command) ? null : message;

  if (group === "doctor" || group === "init" || group === "start" || group === "check" || group === "capabilities") {
    return null;
  }
  if (group === "scan") {
    return exact([undefined, "status"]);
  }
  if (group === "prepare") {
    return null;
  }
  if (group === "ask") {
    return null;
  }
  if (group === "repo") {
    return exact(["map"]);
  }
  if (group === "checks") {
    return exact(["list"]);
  }
  if (group === "policy") {
    if (["show", "check-context", "set-egress"].includes(command ?? "")) {
      return null;
    }
    return command === "agent" && ["grant", "revoke"].includes(maybeId ?? "") ? null : message;
  }
  if (group === "conventions") {
    if (["list", "show", "accept", "reject", "edit"].includes(command ?? "")) {
      return null;
    }
    return command === "exception" && maybeId === "add" ? null : message;
  }
  if (group === "contract") {
    if (command === "waivers" && maybeId === "list") {
      return null;
    }
    if (command === "waiver" && maybeId === "add") {
      return null;
    }
    if (command === "waiver" && maybeId === "show") {
      return null;
    }
    if (command === "waiver" && maybeId === "remove") {
      return null;
    }
    return exact(["show", "validate", "export", "import"]);
  }
  if (group === "findings") {
    return exact(["list", "show", "mark-fixed", "mark-needs-review", "suppress", "accept-drift", "mark-false-positive"]);
  }
  if (group === "audit") {
    return exact(["list", "verify"]);
  }
  if (group === "backup") {
    return exact(["create", "list", "verify"]);
  }
  if (group === "baseline") {
    return exact(["create", "status", "clear"]);
  }
  if (group === "restore") {
    return null;
  }
  return message;
}

export function validateCommandShape(parsed: ParsedArgs): void {
  const [group, command, maybeId] = parsed.positional;
  if (!group) {
    return;
  }

  const exact = (label: string, count: number): void => {
    if (parsed.positional.length > count) {
      throw new Error(`Unexpected argument for ${label}: ${parsed.positional[count]}`);
    }
  };

  if (group === "doctor" || group === "init" || group === "start" || group === "check" || group === "capabilities") {
    exact(group, 1);
    return;
  }
  if (group === "scan") {
    exact(command === "status" ? "scan status" : "scan", command === "status" ? 2 : 1);
    return;
  }
  if (group === "prepare") {
    return;
  }
  if (group === "ask") {
    return;
  }
  if (group === "repo" && command === "map") {
    exact("repo map", 2);
    return;
  }
  if (group === "checks" && command === "list") {
    exact("checks list", 2);
    return;
  }
  if (group === "policy") {
    if (command === "agent" && (maybeId === "grant" || maybeId === "revoke")) {
      exact(`policy agent ${maybeId}`, 3);
      return;
    }
    exact(`policy ${command}`, 2);
    return;
  }
  if (group === "conventions") {
    if (command === "exception" && maybeId === "add") {
      exact("conventions exception add", 4);
      return;
    }
    exact(`conventions ${command}`, command === "list" ? 2 : 3);
    return;
  }
  if (group === "contract") {
    if (command === "waivers" && maybeId === "list") {
      exact("contract waivers list", 3);
      return;
    }
    if (command === "waiver" && maybeId === "add") {
      exact("contract waiver add", 3);
      return;
    }
    if (command === "waiver" && maybeId === "show") {
      exact("contract waiver show", 4);
      return;
    }
    if (command === "waiver" && maybeId === "remove") {
      exact("contract waiver remove", 4);
      return;
    }
    exact(`contract ${command}`, command === "import" ? 3 : 2);
    return;
  }
  if (group === "findings") {
    exact(`findings ${command}`, command === "list" ? 2 : 3);
    return;
  }
  if (group === "audit" && (command === "list" || command === "verify")) {
    exact(`audit ${command}`, 2);
    return;
  }
  if (group === "backup") {
    exact(`backup ${command}`, command === "verify" ? 3 : 2);
    return;
  }
  if (group === "baseline") {
    exact(`baseline ${command}`, 2);
    return;
  }
  if (group === "restore") {
    exact("restore", 2);
  }
}
