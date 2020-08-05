pragma solidity ^0.5.0;

import "./SignatureVerifier.sol";
import "./PhoenixIdentityResolver.sol";

import "./interfaces/ClientPhoenixAuthenticationInterface.sol";
import "./interfaces/PhoenixInterface.sol";
import "./interfaces/IdentityRegistryInterface.sol";
import "./interfaces/PhoenixIdentityInterface.sol";

import "./zeppelin/math/SafeMath.sol";


interface giftCardRedeemer {
    function receiveRedeemApproval(uint _giftCardId, uint256 _value, address _giftCardContract, bytes calldata _extraData) external;
}


contract PhoenixGiftCard is PhoenixIdentityResolver, SignatureVerifier {
    using SafeMath for uint;

    // SC variables
    PhoenixIdentityInterface private phoenixIdentity;

    /* address public identityRegistryAddress; */
    IdentityRegistryInterface private identityRegistry;
    /* address public phoenixTokenAddress; */
    PhoenixInterface private phoenixToken;
    /* address public clientPhoenixAuthenticationAddress; */
    ClientPhoenixAuthenticationInterface private clientPhoenixAuthentication;

    struct Offer {
      uint[] amounts;   // Available gift card denominations
    }
    // Mapping from vendor's EIN to Offer
    mapping (uint => Offer) private offers;

    uint maxGiftCardId;
    struct GiftCard {
      uint id;          // unique GiftCard identifier
      uint vendor;      // vendor's EIN
      uint customer;    // customer's/recipient's EIN
      uint balance;     // amount of PHNX remaining
      uint vendorRedeemAllowed;   // amount authorized for the vendor to transfer
    }

    // Mapping of customer's EIN to array of GiftCard IDs
    mapping(uint => uint[]) private customerGiftCardIds;

    // Mapping of vendor's EIN to array of GiftCard IDs
    mapping(uint => uint[]) private vendorGiftCardIds;

    mapping(uint => GiftCard) private giftCardsById;

    // signature variables
    uint public signatureTimeout = 1 days;

    // enforces signature timeouts
    modifier ensureSignatureTimeValid(uint timestamp) {
        require(
            // solium-disable-next-line security/no-block-members
            block.timestamp >= timestamp && block.timestamp < timestamp + signatureTimeout, "Timestamp is not valid."
        );
        _;
    }

    constructor (address _phoenixIdentityAddress) PhoenixIdentityResolver(
        "PhoenixGiftCard",
        "PhoenixIdentity-powered PHNX gift cards",
        _phoenixIdentityAddress,
        false,   // _callOnAddition
        false     // _callOnRemoval
    ) public {
      setPhoenixIdentityAddress(_phoenixIdentityAddress);
    }

    function setPhoenixIdentityAddress(address _phoenixIdentityAddress) public onlyOwner {
        phoenixIdentityAddress = _phoenixIdentityAddress;
        phoenixIdentity = PhoenixIdentityInterface(phoenixIdentityAddress);
        identityRegistry = IdentityRegistryInterface(phoenixIdentity.identityRegistryAddress());
        phoenixToken = PhoenixInterface(phoenixIdentity.phoenixTokenAddress());
        clientPhoenixAuthentication = ClientPhoenixAuthenticationInterface(phoenixIdentity.clientPhoenixAuthenticationAddress());
        maxGiftCardId = 1000;
    }

    function onAddition(uint ein, uint allowance, bytes memory) public senderIsPhoenixIdentity() returns (bool) {}
    function onRemoval(uint ein, bytes memory) public senderIsPhoenixIdentity() returns (bool) {
      // We don't need to verify the input 'ein' because of the senderIsPhoenixIdentity check.

      // If EIN is associated with vendor Offers, refund all vendor GiftCards
      uint[] memory vendorCards = vendorGiftCardIds[ein];
      for (uint i=0; i<vendorCards.length; i++) {
        refund(i);
      }
      if (vendorCards.length > 0) {
        uint[] memory amount;
        offers[ein] = Offer(amount);
        vendorGiftCardIds[ein] = amount;
      }

      // If EIN is associated wtih customer GiftCards, refund all their GiftCards
      uint[] memory customerCards = customerGiftCardIds[ein];
      for (uint j=0; j<customerCards.length; j++) {
        refund(j);
      }
      if (customerCards.length > 0) {
        uint[] memory temp;
        customerGiftCardIds[ein] = temp;
      }
    }

    /***************************************************************************
    *   Vendor functions
    ***************************************************************************/
    function setOffers(uint[] memory _amounts) public {
      uint _vendorEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN

      offers[_vendorEIN] = Offer(_amounts);
      emit PhoenixGiftCardOffersSet(_vendorEIN, _amounts);
    }

    function getOffers(uint _vendorEIN) public view returns (uint[] memory) {
      return offers[_vendorEIN].amounts;
    }

    /* Refund PHNX to customer's PhoenixIdentity */
    function refund(uint _giftCardId) private {
      GiftCard storage giftCard = giftCardsById[_giftCardId];
      require(giftCard.id != 0, "Invalid giftCardId");

      // Escrow account should have sufficient funds
      require(phoenixToken.balanceOf(address(this)) >= giftCard.balance);

      uint _amountToRefund = giftCard.balance;

      // Zero out the gift card
      giftCard.balance = 0;

      // Refund balance back into customer's phoenixIdentity
      transferPhoenixBalanceTo(giftCard.customer, _amountToRefund);

      emit PhoenixGiftCardRefunded(giftCard.id, giftCard.vendor, giftCard.customer, _amountToRefund);
    }

    /* Refund PHNX to customer's PhoenixIdentity */
    function refundGiftCard(uint _giftCardId) public {
      GiftCard storage giftCard = giftCardsById[_giftCardId];
      require(giftCard.id != 0, "Invalid giftCardId");
      uint _vendorEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN

      require(giftCard.vendor == _vendorEIN, "You don't have permission to refund this gift card");
      if (giftCard.balance == 0) {
        // Nothing to do
        return;
      }

      refund(_giftCardId);
    }


    /***************************************************************************
    *   Buyer functions
    ***************************************************************************/
    function purchaseOffer(uint _vendorEIN, uint _value) public {
      require(identityRegistry.identityExists(_vendorEIN), "The recipient EIN does not exist.");
      uint _buyerEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN

      // Has the buyer added this resolver to their phoenixIdentity?
      require(identityRegistry.isResolverFor(_buyerEIN, address(this)), "The EIN has not set this resolver");

      // Does this vendor have any offers?
      require(offers[_vendorEIN].amounts.length != 0, "Vendor has no available offers");

      // Does the vendor offer this amount in a gift card?
      Offer memory vendorOffers = offers[_vendorEIN];
      bool offerFound = false;
      for (uint i=0; i<vendorOffers.amounts.length; i++) {
        if (vendorOffers.amounts[i] == _value) {
          offerFound = true;
          break;
        }
      }
      require(offerFound, "Vendor does not offer this denomination");

      // Transfer the PHNX funds into the contract first...
      phoenixIdentity.withdrawPhoenixIdentityBalanceFrom(_buyerEIN, address(this), _value);

      // ...then add to the ledger
      maxGiftCardId += 1;
      GiftCard memory gc = GiftCard(maxGiftCardId, _vendorEIN, _buyerEIN, _value, 0);
      customerGiftCardIds[_buyerEIN].push(gc.id);
      vendorGiftCardIds[_vendorEIN].push(gc.id);
      giftCardsById[maxGiftCardId] = gc;

      // Announce GiftCard purchased Event
      emit PhoenixGiftCardPurchased(_vendorEIN, _buyerEIN, _value);
    }

    function transferGiftCard(
        uint _giftCardId, uint _recipientEIN,
        uint8 v, bytes32 r, bytes32 s
    ) public {
      // GiftCard must exist
      require(giftCardsById[_giftCardId].id != 0, "Invalid _giftCardId");
      uint _buyerEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN
      GiftCard storage giftCard = giftCardsById[_giftCardId];

      require(giftCard.customer == _buyerEIN, "You aren't the owner of this gift card.");
      require(giftCard.balance > 0, "Can't transfer an empty gift card.");
      identityRegistry.getIdentity(_recipientEIN);     // throws error if unknown EIN

      // Many addresses might be associated with the customer's EIN, but redemption
      //  must be signed by the address associated with the customer's ClientPhoenixAuthentication
      (address _buyerAddress, string memory buyerCasedPhoenixID) = clientPhoenixAuthentication.getDetails(giftCard.customer);
      require(msg.sender == _buyerAddress, "Transfer was not approved from the clientPhoenixAuthentication address");

      // Transfer must be signed by the customer
      require(
          isSigned(
              _buyerAddress,
              keccak256(
                  abi.encodePacked(
                      byte(0x19), byte(0), address(this),
                      "I authorize the transfer of this gift card.",
                      giftCard.id, _recipientEIN
                  )
              ),
              v, r, s
          ),
          "Permission denied."
      );

      // Remove this GiftCard from the original customer's Mapping
      uint[] storage giftCardIds = customerGiftCardIds[_buyerEIN];
      if (giftCardIds.length == 1) {
        giftCardIds.pop();
      } else {
        for (uint i=0; i<giftCardIds.length; i++) {
          if (giftCardIds[i] == _giftCardId) {
            // Copy the last id over the outgoing id...
            giftCardIds[i] = giftCardIds[giftCardIds.length - 1];

            // ...and trim the whole array
            giftCardIds.pop();
            break;
          }
        }
      }

      // Transfer the ownership in the object...
      giftCard.customer = _recipientEIN;

      // ...and in the recipient's mapping
      uint[] storage recipientCardIds = customerGiftCardIds[_recipientEIN];
      recipientCardIds.push(_giftCardId);

      emit PhoenixGiftCardTransferred(_giftCardId, _buyerEIN, _recipientEIN);
    }

    /***************************************************************************
    *   Redeem functions
    ***************************************************************************/
    /* Gift cards can only be redeemed by the holder's PhoenixAuthentication address */
    function redeem(
        uint _giftCardId, uint _amount, uint _timestamp,
        uint8 v, bytes32 r, bytes32 s
    ) public ensureSignatureTimeValid(_timestamp) {
      // GiftCard must exist
      require(giftCardsById[_giftCardId].id != 0, "Invalid giftCardId");
      GiftCard storage giftCard = giftCardsById[_giftCardId];

      uint _customerEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN

      require(giftCard.customer == _customerEIN, "You aren't the owner of this gift card.");
      require(giftCard.balance > 0, "Can't redeem an empty gift card.");
      require(giftCard.balance >= _amount, "Can't redeem more than gift card's balance");

      // Many addresses might be associated with the customer's EIN, but redemption
      //  must be signed by the address associated with the customer's ClientPhoenixAuthentication
      (address _customerAddress, string memory customerCasedPhoenixID) = clientPhoenixAuthentication.getDetails(giftCard.customer);
      require(msg.sender == _customerAddress, "Redeem was not approved from the clientPhoenixAuthentication address");

      // Redemption must be signed by the customer
      require(
          isSigned(
              _customerAddress,
              keccak256(
                  abi.encodePacked(
                      byte(0x19), byte(0), address(this),
                      "I authorize the redemption of this gift card.",
                      giftCard.id, _amount, _timestamp
                  )
              ),
              v, r, s
          ),
          "Permission denied."
      );

      // Apply changes
      giftCard.balance = giftCard.balance.sub(_amount);
      giftCard.vendorRedeemAllowed = giftCard.vendorRedeemAllowed.add(_amount);

      emit PhoenixGiftCardRedeemAllowed(_giftCardId, giftCard.vendor, giftCard.customer, _amount);
    }

    /*  Version of redeem() that will automatically call the vendor's specified
        smart contract to accept the redemption and continue processing. */
    function redeemAndCall(
      uint _giftCardId, uint _amount, uint _timestamp,
      uint8 v, bytes32 r, bytes32 s,
      address _vendorContractAddress, bytes memory _extraData
    ) public ensureSignatureTimeValid(_timestamp) {
      // Will exit with exceptions if redemption authorization fails
      redeem(_giftCardId, _amount, _timestamp, v, r, s);

      // Invoke the vendor's redemption function in their smart contract
      giftCardRedeemer vendorContract = giftCardRedeemer(_vendorContractAddress);
      vendorContract.receiveRedeemApproval(_giftCardId, _amount, address(this), _extraData);
    }

    /*  Called within the vendor's receiveRedeemApproval() in their smart contract to
        actually transfer the PHNX out of the GiftCard. To protect against vendor
        address spoofing, payment will ONLY go to the vendor's address that is linked
        in their identity; the GiftCard will not pay out to the calling address/smart
        contract. */
    function vendorRedeem(uint _giftCardId, uint _amount) public {
      GiftCard storage giftCard = giftCardsById[_giftCardId];

      require(giftCard.id != 0, "Not a valid giftCardId");
      require(giftCard.vendorRedeemAllowed >= _amount, "Redemption amount is greater than what is authorized");

      // Update the GiftCard's allowance accounting...
      giftCard.vendorRedeemAllowed = giftCard.vendorRedeemAllowed.sub(_amount);

      // ...and only now do we do the transfer, and only to the vendor's PhoenixIdentity
      transferPhoenixBalanceTo(giftCard.vendor, _amount);

      emit PhoenixGiftCardVendorRedeemed(_giftCardId, giftCard.vendor, giftCard.customer, _amount);
    }


    /***************************************************************************
    *   Public getters
    ***************************************************************************/
    function getGiftCardBalance(uint _giftCardId) public view returns (uint) {
      return giftCardsById[_giftCardId].balance;
    }

    function getGiftCard(uint _id)
      public view returns(
        string memory vendorCasedPhoenixID,
        string memory customerCasedPhoenixID,
        uint balance
    ) {
      GiftCard memory _giftCard = giftCardsById[_id];

      (address _vendorAddress, string memory _vendorCasedPhoenixID) = clientPhoenixAuthentication.getDetails(_giftCard.vendor);
      (address _customerAddress, string memory _customerCasedPhoenixID) = clientPhoenixAuthentication.getDetails(_giftCard.customer);
      return (_vendorCasedPhoenixID, _customerCasedPhoenixID,  _giftCard.balance);
    }

    function getCustomerGiftCardIds() public view returns(uint[] memory giftCardIds) {
      uint _buyerEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN
      return customerGiftCardIds[_buyerEIN];
    }

    function getVendorGiftCardIds() public view returns(uint[] memory giftCardIds) {
      uint _vendorEIN = identityRegistry.getEIN(msg.sender);   // throws error if address not associated with an EIN
      return vendorGiftCardIds[_vendorEIN];
    }


    event Debug(string);
    event Debug(uint);

    event PhoenixGiftCardOffersSet(uint indexed vendorEIN, uint[] amounts);
    event PhoenixGiftCardPurchased(uint indexed vendorEIN, uint indexed buyerEIN, uint amount);
    event PhoenixGiftCardRefunded(uint indexed id, uint indexed vendorEIN, uint indexed customerEIN, uint amount);
    event PhoenixGiftCardTransferred(uint indexed id, uint indexed buyerEIN, uint indexed recipientEIN);
    event PhoenixGiftCardRedeemAllowed(uint indexed id, uint indexed vendorEIN, uint indexed customerEIN, uint amount);
    event PhoenixGiftCardVendorRedeemed(uint indexed id, uint indexed vendorEIN, uint indexed customerEIN, uint amount);
}
