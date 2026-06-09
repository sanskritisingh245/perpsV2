// Shared in-memory order book store for the matching engine.
// Both the matcher (reads levels) and the engine loop (rests leftover
// orders) use these same types and helpers, so the book stays consistent.

export type OpenOrder = {
    userId: string;
    orderId: string;
    qty: number;
    filledQty: number;
};

export type Level = {
    availableQty: number;
    openOrders: OpenOrder[];
};

export type Book = {
    marketId: string;
    asks: Record<string, Level>; // resting SELL orders, keyed by price
    bids: Record<string, Level>; // resting BUY orders, keyed by price
    lastTradePrice: number;
};

const books = new Map<string, Book>();

// One book per market. Created lazily the first time a market is seen.
export function getOrCreateBook(marketId: string): Book {
    let book = books.get(marketId);
    if (!book) {
        book = { marketId, asks: {}, bids: {}, lastTradePrice: 0 };
        books.set(marketId, book);
    }
    return book;
}

// Rest a leftover taker order into the book as a new maker order.
// A BUY rests on the bid side, a SELL rests on the ask side.
export function restOrder(
    marketId: string,
    side: "BUY" | "SELL",
    price: number,
    order: OpenOrder,
) {
    const book = getOrCreateBook(marketId);
    const levels = side === "BUY" ? book.bids : book.asks;
    const key = String(price);
    if (!levels[key]) {
        levels[key] = { availableQty: 0, openOrders: [] };
    }
    levels[key].openOrders.push(order);
    levels[key].availableQty += order.qty - order.filledQty;
}

export function restoreBook(book:Book){
    books.set(book.marketId, book);
}