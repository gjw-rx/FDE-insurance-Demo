// 静态示例数据，仅用于首屏静态壳展示。
// 接入 API 的后续 change 会整体替换本模块，不要在其他位置复制这些数据。

export interface InsurerOption {
  id: string;
  name: string;
  englishName: string;
  brandColor: string;
}

export const currentUser = {
  name: "Max",
};

export const welcomeMessage = {
  timestamp: "2024-05-31 16:25:28",
  text: "您好！我是智能车险助手，很高兴为您服务。\n如已拿到行驶证、身份证/营业执照，可直接上传，\n也可直接发送车牌号或VIN码~",
};

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
