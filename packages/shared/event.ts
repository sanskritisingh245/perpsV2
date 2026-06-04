export type OrderCreated={
    type : "order_created"
    orderId:string,
    userId:string,
    market:string,
    side:"BUY"| "SELL",
    price:number,
    qty:number
    timeStamp:number
}

export type TradeExecuted = {
    type:"trade_executed"
    tradeId:String
    buyerId:string
    sellerId:string
    market:string
    price:number
    qty:number
    timeStamp:number
}

export type OrederbookUpdated = {
    type:"orebook_updated"
    market:string
    bestBid:number
    bestAsk:number
    timeStamp:number
}

export type MarkPriceUpdated = {
    type:"markPrice_updated"
    market:string
    markPrice:number
    timestamp:number
}

export const STREAMS = {
  ORDERS: "orders"
};