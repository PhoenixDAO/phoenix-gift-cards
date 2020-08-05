pragma solidity ^0.5.0;

import "./interfaces/ClientPhoenixAuthenticationInterface.sol";
import "./zeppelin/ownership/Ownable.sol";

interface PhoenixGiftCardInterface {
  function vendorRedeem(uint _giftCardId, uint _amount) external;
  function getGiftCard(uint _id) external view returns(
      string memory vendorCasedPhoenixID,
      string memory customerCasedPhoenixID,
      uint balance
  );
}

contract VendorSampleContract is Ownable {
  address public clientPhoenixAuthenticationAddress;
  ClientPhoenixAuthenticationInterface private clientPhoenixAuthentication;

  function setAddresses(address _clientPhoenixAuthenticationAddress) public onlyOwner {
      clientPhoenixAuthenticationAddress = _clientPhoenixAuthenticationAddress;
      clientPhoenixAuthentication = ClientPhoenixAuthenticationInterface(clientPhoenixAuthenticationAddress);
  }

  function receiveRedeemApproval(
    uint _giftCardId, uint256 _value,
    address _giftCardContract, bytes memory _extraData
  ) public {
    /*************************************************************************************
      Called by the PhoenixGiftCard contract's redeemAndCall(). The customer has authorized
      the GiftCard to payout _value to the receiving vendor. Receive the transfer and
      continue handling whatever remains for the customer's transaction. Vendor's smart
      contract must be associated with their vendorEIN for the transfer to be executed.
    *************************************************************************************/

    // Instantiate the PhoenixGiftCard contract interface and get GiftCard details
    PhoenixGiftCardInterface phoenixGiftCard = PhoenixGiftCardInterface(_giftCardContract);
    (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance) = phoenixGiftCard.getGiftCard(_giftCardId);

    // Get the customer's EIN via ClientPhoenixAuthentication
    (uint customerEIN, address customerAddress, string memory _customerCasedPhoenixID) = clientPhoenixAuthentication.getDetails(customerCasedPhoenixID);

    // Tell the PhoenixGiftCard to transfer the PHNX funds
    phoenixGiftCard.vendorRedeem(_giftCardId, _value);

    // Decode params were passed into redeemAndCall())
    uint invoiceId = abi.decode(_extraData, (uint));

    // ...credit customerEIN for invoiceId...

    emit InvoicePaid(invoiceId, _value);
  }

  event InvoicePaid(uint _invoiceId, uint _amount);
}
