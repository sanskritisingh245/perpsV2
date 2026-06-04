import { getOrCreateBook, type Level } from "../src/book";

type Fill = {
    makerUserId: string;
    makerOrderId: string;
    takerUserId:string;
    takerOrderId:string;
    qty: number;
    price: number;
};

export function match(
    userId:string,
    orderId:string,
    symbol:string,
    side:"BUY" | "SELL",
    quantity:number,
    price:number,
){
    const book = getOrCreateBook(symbol);
    // A BUY matches against resting sells (asks); a SELL against resting buys (bids).
    const levels = side === "BUY" ? book.asks : book.bids;
    return matchSide(levels , side , userId , orderId , symbol , quantity , price)
}

export  function matchSide(
    levels: Record<string, Level>,
    side: "BUY" | "SELL",
    takerUserId:string,
    takerOrderId:string,
    symbol: string,
    quantity: number,
    price: number,

) : { fills: Fill[] ; remainingQty: number} {
    const isLong = side === "BUY";

    const sortedPrice=Object.keys(levels).map(Number)
    .sort((a, b)=> isLong ? a-b : b-a);

    let remainingQty= quantity;
    const fills: Fill[]=[];


    for (const levelPrice of sortedPrice){
        if (isLong ? levelPrice > price : levelPrice < price) break;   // limit of the take check 

        const level = levels[levelPrice.toString()];
        if (!level) continue;

        for(const order of level.openOrders){
            if(remainingQty === 0 ) break;
            const fillable = order.qty - order.filledQty;
            if(fillable === 0) continue;
        
            if(order.userId === takerUserId) continue; // user's own resting order skipped  Users cannot trade against themselves.

            const take = Math.min(remainingQty, fillable);
            order.filledQty += take;
            level.availableQty = Math.max(0, level.availableQty - take);
            remainingQty-= take;

            fills.push({
                makerUserId:order.userId,
                makerOrderId:order.orderId,
                takerUserId,
                takerOrderId,
                qty:take,
                price:levelPrice
            });
        }
    }

    return { fills, remainingQty };
}