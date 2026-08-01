import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Store } from "lucide-react";

import { useEnvironmentStore } from "@/stores/environment";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function EnvSelector() {
  const names = useEnvironmentStore((s) => s.names);
  const activeEnv = useEnvironmentStore((s) => s.activeEnv);
  const vars = useEnvironmentStore((s) => s.vars);
  const setActive = useEnvironmentStore((s) => s.setActive);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number>();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasVars = activeEnv && Object.keys(vars).length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "折叠" : "展开"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <Store className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          环境
        </span>
      </div>
      <Select
        value={activeEnv ?? "__none__"}
        onValueChange={(v) => setActive(v === "__none__" ? null : v)}
      >
        <SelectTrigger ref={triggerRef}>
          <SelectValue placeholder="无环境" />
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="top"
          align="start"
          sideOffset={4}
          avoidCollisions={false}
          style={width ? { width: `${width}px` } : undefined}
        >
          <SelectItem value="__none__">无环境</SelectItem>
          {names.map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {expanded && hasVars && (
        <div className="flex flex-col gap-0.5 rounded-md border bg-muted/30 p-1.5">
          {Object.entries(vars).slice(0, 8).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1 text-[11px]">
              <span className="shrink-0 font-mono text-muted-foreground">{k}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate font-mono cursor-default">{v}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-md break-all">
                  {v}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
          {Object.keys(vars).length > 8 && (
            <span className="text-[10px] text-muted-foreground">
              +{Object.keys(vars).length - 8} 更多...
            </span>
          )}
        </div>
      )}
      {names.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          工作区根目录创建 env.json 定义环境变量
        </p>
      )}
    </div>
  );
}