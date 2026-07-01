// Shapes mirror exactly what the backend returns — nothing more.

export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "OPEN" | "FILLED" | "PARTIALLY_FILLED" | "CANCELLED";
export type PositionSide = "LONG" | "SHORT";

export type Balance = {
  id: string;
  userId: string;
  asset: string;
  available: string;
  locked: string;
};

export type Order = {
  id: string;
  userId: string;
  marketId: string;
  orderType: OrderType;
  side: Side;
  price: string | null;
  slippage: number | null;
  qty: string;
  initialMargin: string;
  filledQty: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type Position = {
  id: string;
  userId: string;
  marketId: string;
  side: PositionSide;
  qty: string;
  entryPrice: string;
  margin: string;
};

export type Market = {
  id: string;
  slug: string;
  imageUrl?: string;
};

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type BookLevel = { price: number; qty: number };
export type OrderBook = {
  marketId: string;
  bids: BookLevel[];
  asks: BookLevel[];
  lastTradePrice: number;
};

// Raw fill broadcast by the ws-server (all fields are strings off the stream).
export type Fill = {
  marketId: string;
  price: string;
  qty: string;
  takerUserId: string;
  takerOrderId: string;
  takerSide: Side;
  takerLeverage: string;
  makerUserId: string;
  makerOrderId: string;
  makerLeverage: string;
};
