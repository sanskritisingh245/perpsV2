type Order = {
    orderId:string,
    side:"BUY" | "SELL",
    price:string,
    qty:string
};

export class OrderBook {
    bids : Order[] =[];
    asks: Order[] =[];

    matchOrder(order:Order){
        if(order.side === "BUY"){
            
        }
    }
}