import { shouldRequestEnvironmentData } from "./environment";

/**
 * 断言两个值严格相等。
 * 入参：实际值、期望值和失败说明。
 * 出参：无；不相等时抛出异常。
 * 作用与流程：为启动阶段环境加载判断提供轻量回归测试。
 */
function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

expectEqual(
  shouldRequestEnvironmentData(null),
  false,
  "welcome page should not request workspace environment data",
);
expectEqual(
  shouldRequestEnvironmentData("/repo"),
  true,
  "opened workspaces should request environment data",
);

console.log("environment startup tests passed");
