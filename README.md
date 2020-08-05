# PhoenixGiftCard

## Overview
`PhoenixGiftCard` is implemented as a PhoenixIdentity Resolver which uses the Resolver's allowance system to facilitate easier PHNX token exchanges. The customer must deposit PHNX into their phoenixIdentity and would then add `PhoenixGiftCard` as a resolver for their phoenixIdentity and allocate a sufficient allowance which they'll use to purchase `GiftCards`.

Vendors will specify `Offers` consisting of the gift card denominations that will be available to purchase (e.g. 100,000 PHNX, 50,000 PHNX, etc.). Vendors must have an identity registered in the Phoenix ecosystem as their `Offers` are tied to their EIN.

Customers may buy a vendor's `Offer` for the exact amount of PHNX which will be deducted from the `PhoenixGiftCard` resolver's allowance. The resulting `GiftCard` is tied to the customer's EIN and the vendor's EIN in a simple struct:

```solidity
struct GiftCard {
  uint id;          // unique GiftCard identifier
  uint vendor;      // vendor's EIN
  uint customer;    // customer's/recipient's EIN
  uint balance;     // amount of PHNX remaining
  uint vendorRedeemAllowed;   // amount authorized for the vendor to transfer
}
```

The funds are held in escrow in the `PhoenixGiftCard` smart contract until they are either redeemed or refunded.

The typical use case would have the customer then gift the `GiftCard` to another user. The recipient must have an identity and upon transfer would be entered as the new `GiftCard.customer` EIN. This transfer can only be authorized by the current `GiftCard.customer` via a signed permission statement from the customer's ClientPhoenixAuthentication address.

The recipient can then redeem the `GiftCard` by spending it at the vendor. Redemption also requires a signed permission statement from the recipient's ClientPhoenixAuthentication address. The authorized funds can only be transferred to the vendor.

The vendor's side of redeeming a `GiftCard` is demonstrated in the `VendorSampleContract`. Its `receiveRedeemApproval()` function is analagous to ERC-20's `receiveApproval()`. It allows the vendor's smart contract to trigger the funds transfer and then complete whatever business logic it needs to attend to.

A basic refund mechanism allows vendors to close out their `GiftCards` and transfer the remaining PHNX balance out of escrow and back to the customer.

## Deviations from the original requirements
1. Gift cards not offered in limited quantities. I just couldn't see the business use case for this requirement. Why would a vendor sell the 50th gift card but decline to sell the 51st?

1. Gift cards do not expire. In California and in other locales it is illegal for gift cards to expire.

1. The refund mechanism was not part of the requirements, but unspent funds have to have a way to be returned from escrow, especially if the vendor is closing shop or exiting the Phoenix ecosystem.

## Testing With Truffle
- This folder has a suite of tests created through [Truffle](https://github.com/trufflesuite/truffle).
- To run these tests:
  - Clone this repo
  - Run `npm install`
  - Build dependencies with `npm run build`
  - Spin up a development blockchain: `npm run chain`
  - In another terminal tab, run the test suite: `npm test`
