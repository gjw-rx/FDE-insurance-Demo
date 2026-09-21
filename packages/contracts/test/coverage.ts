/**
 * 编译期穷举表的构造辅助。
 *
 * 受控取值的事实来源是 `src/` 下的取值数组（例如 `CHAT_MESSAGE_STATUSES`），
 * 穷举表只是把这些取值转成 `Record<联合类型, true>`：返回类型要求覆盖联合类型的
 * 每个取值，漏掉或多出取值都会让 `tsc` 失败。
 *
 * 这里存在一次局部类型断言，因为逐个赋值构造 `Record` 无法让类型系统从循环推断出
 * 完整键集合；断言限定在本函数内，不对调用方放宽类型。
 */
export function buildCoverage<T extends string>(
  values: readonly T[],
): Record<T, true> {
  const coverage = {} as Record<T, true>;
  for (const value of values) {
    coverage[value] = true;
  }
  return coverage;
}
