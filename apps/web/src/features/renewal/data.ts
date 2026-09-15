// 静态续保数据，仅用于工作台首屏展示。
export interface InsurerOption {
  id: string;
  name: string;
  englishName: string;
  brandColor: string;
}

export const latestQuote = {
  plateNo: "粤B196YS",
  summary: "交强险 ¥950 · 商业险 ¥2,318 · 合计 ¥3,268",
};

export const insurerOptions: readonly InsurerOption[] = [
  {
    id: "pingan",
    name: "中国平安保险",
    englishName: "PING AN INSURANCE",
    brandColor: "#EE6B2D",
  },
  {
    id: "cpic",
    name: "太平洋保险",
    englishName: "CPIC INSURANCE",
    brandColor: "#174A96",
  },
  {
    id: "china-life-pc",
    name: "国寿财",
    englishName: "CHINA LIFE P&C",
    brandColor: "#4BAE8D",
  },
  {
    id: "sunshine",
    name: "阳光保险",
    englishName: "SUNSHINE INSURANCE",
    brandColor: "#F0A91C",
  },
];

// 原型初始状态：太平洋保险为「已选择」，其余为「请选择」。
export const initiallySelectedInsurerId = "cpic";
