const common = require('./common.js')
const { sign, verifyIdentity } = require('./utilities')

let user
let instances

contract('Testing PhoenixGiftCard', function (accounts) {
  const owner = accounts[0]

  let vendor1 = {
    phoenixID: 'vendor1',
    address: accounts[1],
    recoveryAddress: accounts[1],
    private: '0x6bf410ff825d07346c110c5836b33ec76e7d1ee051283937392180b732aa3aff',
    identity: web3.utils.toBN(1)
  }
  let vendor2 = {
    phoenixID: 'vendor2',
    address: accounts[2],
    recoveryAddress: accounts[2],
    private: '0xccc3c84f02b038a5d60d93977ab11eb57005f368b5f62dad29486edeb4566954',
    identity: web3.utils.toBN(2)
  }
  let customer1 = {
    phoenixID: 'customer1',
    address: accounts[3],
    recoveryAddress: accounts[3],
    private: '0xfdf12368f9e0735dc01da9db58b1387236120359024024a31e611e82c8853d7f',
    identity: web3.utils.toBN(3)
  }
  let customer2 = {
    phoenixID: 'customer2',
    address: accounts[4],
    recoveryAddress: accounts[4],
    private: '0x44e02845db8861094c519d72d08acb7435c37c57e64ec5860fb15c5f626cb77c',
    identity: web3.utils.toBN(4)
  }
  let recipient1 = {
    phoenixID: 'recipient1',
    address: accounts[5],
    recoveryAddress: accounts[5],
    private: '0x12093c3cd8e0c6ceb7b1b397724cd82c4d84f81263f56a44f11d8bd3a61ffccb',
    identity: web3.utils.toBN(5)
  }
  let recipient2 = {
    phoenixID: 'recipient',
    address: accounts[6],
    recoveryAddress: accounts[6],
    private: '0xf65450adda73b32e056ed24246d8d370e49fc88b427f96f37bbf23f6b132b93b',
    identity: web3.utils.toBN(6)
  }
  let other1 = {
    address: accounts[7],
    private: '0x34a1f9ed996709f629d712d5b267d23f37be82bf8003a023264f71005f6486e6',
  }

  const offerAmounts = [
    web3.utils.toWei("1000", "gwei"),
    web3.utils.toWei("5000", "gwei"),
    web3.utils.toWei("10000", "gwei"),
  ]

  it('common contracts deployed', async () => {
    instances = await common.initialize(accounts[0], [], accounts[1])
  })

  describe('Test PhoenixToken', async () => {
    it('can transfer PHNX tokens', async function () {
      let amount = web3.utils.toBN(offerAmounts[0]).mul(web3.utils.toBN('50'))
      await instances.PhoenixToken.transfer(
        customer1.address,
        amount,
        { from: accounts[0] }
      )

      let customerBalance = await instances.PhoenixToken.balanceOf(customer1.address)
      assert(customerBalance.gt(web3.utils.toBN('0')), "Customer1 did not receive PHNX")
      assert(customerBalance.eq(amount), "Customer1 did not receive the correct amount of PHNX")

      // Also seed 'other1' with PHNX for later tests
      await instances.PhoenixToken.transfer(
        other1.address,
        amount,
        { from: accounts[0] }
      )

      await instances.PhoenixToken.transfer(
        recipient2.address,
        amount,
        { from: accounts[0] }
      )
    })
  })

  describe('Test Snowflake', async () => {
    async function createSnowflakeIdentity(_user) {
      const timestamp = Math.round(new Date() / 1000) - 1
      const permissionString = web3.utils.soliditySha3(
        '0x19', '0x00', instances.IdentityRegistry.address,
        'I authorize the creation of an Identity on my behalf.',
        _user.recoveryAddress,
        _user.address,
        { t: 'address[]', v: [instances.Snowflake.address] },
        { t: 'address[]', v: [] },
        timestamp
      )

      const permission = await sign(permissionString, _user.address, _user.private)

      await instances.Snowflake.createIdentityDelegated(
        _user.recoveryAddress, _user.address, [], _user.phoenixID, permission.v, permission.r, permission.s, timestamp
      )

      await verifyIdentity(_user.identity, instances.IdentityRegistry, {
        recoveryAddress:     _user.recoveryAddress,
        associatedAddresses: [_user.address],
        providers:           [instances.Snowflake.address],
        resolvers:           [instances.ClientRaindrop.address]
      })
    }

    it('Identities can be created', async function () {
      await createSnowflakeIdentity(vendor1)
      await createSnowflakeIdentity(vendor2)
      await createSnowflakeIdentity(customer1)
      await createSnowflakeIdentity(customer2)
      await createSnowflakeIdentity(recipient1)
      await createSnowflakeIdentity(recipient2)

      // Confirm that we can retrieve their info from the registry
      let ein = await instances.IdentityRegistry.getEIN(customer1.address)
      assert(ein.eq(customer1.identity))

      await instances.IdentityRegistry.getIdentity(ein)

      // Returns (uint ein, address _address, string memory casedPhoenixID)
      let details = await instances.ClientRaindrop.getDetails(customer1.phoenixID)
      assert(details[2] == customer1.phoenixID)
    })

    it('can deposit PHNX into snowflake', async () => {
      const depositAmount = web3.utils.toBN(offerAmounts[0]).mul(web3.utils.toBN('25'))
      await instances.PhoenixToken.approveAndCall(
        instances.Snowflake.address, depositAmount, web3.eth.abi.encodeParameter('uint256', customer1.identity.toString()),
        { from: customer1.address }
      )

      const snowflakeBalance = await instances.Snowflake.deposits(customer1.identity)
      assert.isTrue(snowflakeBalance.eq(depositAmount), 'Incorrect balance')

      await instances.PhoenixToken.approveAndCall(
        instances.Snowflake.address, depositAmount, web3.eth.abi.encodeParameter('uint256', recipient2.identity.toString()),
        { from: recipient2.address }
      )
    })

    it('PhoenixGiftCard can be added as a Resolver', async function () {
      instances.Snowflake.addResolver(
        instances.PhoenixGiftCard.address,
        true,
        web3.utils.toBN(offerAmounts[0]).mul(web3.utils.toBN('10')),   // allowance
        '0x00', { from: customer1.address }
      )

      instances.Snowflake.addResolver(
        instances.PhoenixGiftCard.address,
        true,
        web3.utils.toBN(offerAmounts[0]).mul(web3.utils.toBN('10')),   // allowance
        '0x00', { from: recipient2.address }
      )
    })
  })

  async function buyGiftCard(vendorEIN, amount, buyerAddress) {
    await instances.PhoenixGiftCard.purchaseOffer(vendorEIN, amount, { from: buyerAddress })
  }

  async function signRedeem(giftCardId, amount, timestamp, user) {
    const permissionString = web3.utils.soliditySha3(
      '0x19', '0x00', instances.PhoenixGiftCard.address,
      'I authorize the redemption of this gift card.',
      giftCardId,
      amount,
      timestamp
    )
    return await sign(permissionString, user.address, user.private)
  }

  describe('Test PhoenixGiftCard', async () => {

    describe("vendor actions", async () => {
      it('vendor w/identity can set Offers', async function () {
        // The vendor can set their Offer from one of their own associated addresses...
        await instances.PhoenixGiftCard.setOffers(offerAmounts, { from: vendor1.address })

        // Confirm the vendor's first offer...
        let retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor1.identity)
        assert(web3.utils.toBN(retrievedAmounts[0]).eq(web3.utils.toBN(offerAmounts[0])))

        // And expect nothing for the other vendor
        retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor2.identity)
        assert(retrievedAmounts.length == 0)
      })

      it('vendor can update Offers', async function () {
        // Confirm the vendor's first offer...
        let retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor1.identity)
        assert(web3.utils.toBN(retrievedAmounts[0]).eq(web3.utils.toBN(offerAmounts[0])))

        // Now change the offers
        let newOffers = [123456, 500, 900]
        await instances.PhoenixGiftCard.setOffers(newOffers, { from: vendor1.address })

        // Confirm the vendor's first offer...
        retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor1.identity)
        assert(web3.utils.toBN(retrievedAmounts[0]).eq(web3.utils.toBN(newOffers[0])))
      })

      it('vendor can remove all Offers', async function () {
        // Confirm the vendor's first offer...
        let retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor1.identity)
        assert(retrievedAmounts.length > 0)

        // Now set empty offers
        await instances.PhoenixGiftCard.setOffers([], { from: vendor1.address })

        retrievedAmounts = await instances.PhoenixGiftCard.getOffers(vendor1.identity)
        assert(retrievedAmounts.length == 0)
      })

      it("vendor w/out identity can't set Offers", async function () {
        await instances.PhoenixGiftCard.setOffers(offerAmounts, { from: other1.address })
          .then(() => assert.fail('address with no identity created Offers', 'call should fail'))
          .catch(error => assert.include(error.message, 'The passed address does not have an identity but should', 'unexpected error'))
      })
    })

    describe("buyer actions", async () => {
      describe("purchasing", async () => {
        it("Buyer w/identity and sufficient PHNX can buy a vendor's Offer", async function () {
          // reset vendor Offers
          await instances.PhoenixGiftCard.setOffers(offerAmounts, { from: vendor1.address })

          let customerBalance = await instances.PhoenixToken.balanceOf(customer1.address)
          assert(customerBalance.gt(web3.utils.toBN(offerAmounts[0])), "Customer1 does not have enough PHNX")

          await buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)

          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })

          // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
          let details = await instances.PhoenixGiftCard.getGiftCard(giftCardIds[0])
          assert(details[2].eq(web3.utils.toBN(offerAmounts[0])), "GiftCard initial balance does not match original Offer")
        })

        it("Buyer can't buy a denomination the vendor doesn't offer", async function () {
          let customerBalance = await instances.PhoenixToken.balanceOf(customer1.address)
          assert(customerBalance.gt(web3.utils.toBN(offerAmounts[0])), "Customer1 does not have enough PHNX")

          await buyGiftCard(vendor1.identity.toNumber(), web3.utils.toBN(offerAmounts[0]).add(web3.utils.toBN("5")), customer1.address)
            .then(() => assert.fail('GiftCard with unsupported denomination was purchased', 'purchase should fail'))
            .catch(error => assert.include(error.message, 'Vendor does not offer this denomination', 'unexpected error'))
        })

        it("Buyer w/out sufficient PHNX allowance can't buy a vendor's Offer", async function () {
          // Change customer1's allowance
          let smallAllowance = web3.utils.toBN(offerAmounts[0]).div(web3.utils.toBN('5'))
          instances.Snowflake.changeResolverAllowances(
            [instances.PhoenixGiftCard.address],
            [smallAllowance],
            { from: customer1.address }
          )

          await instances.PhoenixGiftCard.purchaseOffer(
            vendor1.identity.toNumber(),
            offerAmounts[0],
            { from: customer1.address }
          )
            .then(() => assert.fail('GiftCard was purchased with unsufficient PHNX allowance', 'purchase should fail'))
            .catch(error => assert.include(error.message, 'Insufficient Allowance', 'unexpected error'))

          // Reset customer's allowance
          let allowance = web3.utils.toBN(offerAmounts[0]).mul(web3.utils.toBN('25'))
          instances.Snowflake.changeResolverAllowances(
            [instances.PhoenixGiftCard.address],
            [allowance],
            { from: customer1.address }
          )
        })

        it("Buyer can't buy from a vendor with no Offers", async function () {
          let customerBalance = await instances.PhoenixToken.balanceOf(customer1.address)
          assert(customerBalance.gt(web3.utils.toBN(offerAmounts[0])), "Customer1 does not have enough PHNX")

          // vendor2 has no offers
          await instances.PhoenixGiftCard.purchaseOffer(
            vendor2.identity.toNumber(),
            offerAmounts[0],
            { from: customer1.address }
          )
            .then(() => assert.fail('bought GiftCard from vendor with no Offers', 'transaction should fail'))
            .catch(error => assert.include(error.message, 'Vendor has no available offers', 'unexpected error'))
        })
      })

      describe("gifting", async () => {
        it("Buyer can gift to recipient w/identity", async function () {
          await buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)
          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]

          // recipient1 shouldn't have any
          let recipientGiftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
          assert(recipientGiftCardIds.length == 0, "Recipient1 shouldn't have any GiftCards yet")

          // Build the string the GiftCard holder will have to sign in order to transfer
          const permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            giftCardId,
            recipient1.identity
          )

          const permission = await sign(permissionString, customer1.address, customer1.private)

          await instances.PhoenixGiftCard.transferGiftCard(
            giftCardId, recipient1.identity,
            permission.v, permission.r, permission.s,
            { from: customer1.address }
          )

          // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
          let details = await instances.PhoenixGiftCard.getGiftCard(giftCardId, { from: recipient1.address })
          assert(details[1] == recipient1.phoenixID, "GiftCard customer should be recipient1")
        })

        it("Buyer can't transfer an invalid GiftCard ID", async function () {
          const badGiftCardId = 123456
          // Build the string the GiftCard holder will have to sign in order to transfer.
          let permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            badGiftCardId,
            recipient1.identity
          )

          let permission = await sign(permissionString, customer1.address, customer1.private)

          await instances.PhoenixGiftCard.transferGiftCard(
            badGiftCardId, recipient1.identity,
            permission.v, permission.r, permission.s,
            { from: customer1.address }
          )
            .then(() => assert.fail('Transferred an invalid GiftCard ID', 'transaction should fail'))
            .catch(error => assert.include(error.message, 'Invalid _giftCardId', 'unexpected error'))
        })

        it("Buyer can't transfer a GiftCard they've already gifted", async function () {
          await buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)
          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]

          // Build the string the GiftCard holder will have to sign in order to transfer.
          let permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            giftCardId,
            recipient1.identity
          )

          let permission = await sign(permissionString, customer1.address, customer1.private)

          await instances.PhoenixGiftCard.transferGiftCard(
            giftCardId, recipient1.identity,
            permission.v, permission.r, permission.s,
            { from: customer1.address }
          )

          // Now try to transfer the same GiftCard to someone else
          permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            giftCardId,
            recipient2.identity
          )

          permission = await sign(permissionString, customer1.address, customer1.private)

          await instances.PhoenixGiftCard.transferGiftCard(
            giftCardId, recipient2.identity,
            permission.v, permission.r, permission.s,
            { from: customer1.address }
          )
            .then(() => assert.fail('previous owner transferred GiftCard', 'transaction should fail'))
            .catch(error => assert.include(error.message, 'You aren\'t the owner of this gift card', 'unexpected error'))
        })

        it("Buyer can't gift to a recipient w/out identity", async function () {
          buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)
          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]

          const invalidEIN = 123456

          // Build the string the GiftCard holder will have to sign in order to transfer.
          const permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            giftCardId,
            invalidEIN
          )

          const permission = await sign(permissionString, customer1.address, customer1.private)

          await instances.PhoenixGiftCard.transferGiftCard(
            giftCardId, invalidEIN,
            permission.v, permission.r, permission.s,
            { from: customer1.address }
          )
            .then(() => assert.fail('transferred GiftCard to invalid EIN', 'transaction should fail'))
            .catch(error => assert.include(error.message, 'The identity does not exist', 'unexpected error'))
        })

        it("Buyer can't confirm gift/transfer from non-raindrop address", async function () {
          // Add a new address to the buyer's identity
          const altAddress = accounts[8]
          const timestamp = Math.round(new Date() / 1000) - 1
          const addAddrPermissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.IdentityRegistry.address,
            'I authorize adding this address to my Identity.',
            customer1.identity, altAddress, timestamp
          )
          const addAddrPermission = await sign(addAddrPermissionString, customer1.address, customer1.private);
          await instances.IdentityRegistry.addAssociatedAddress(
            customer1.address, altAddress,
            addAddrPermission.v, addAddrPermission.r, addAddrPermission.s,
            timestamp,
            { from: altAddress }
          )

          // confirm
          assert(await instances.IdentityRegistry.isAssociatedAddressFor(customer1.identity, altAddress), "Newly added address was not associated with EIN")

          buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)
          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]


          // Build the string the GiftCard holder will have to sign in order to transfer.
          const permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the transfer of this gift card.',
            giftCardId, recipient1.identity
          )

          // But this time we sign it using the non-raindrop address that we just added
          const permission = await sign(permissionString, altAddress, "0x1711e5c516428d875c14dac234f36bbf3b4622aeac00566483a8087ed5a97297")

          // And send the transfer call from the non-raindrop address
          await instances.PhoenixGiftCard.transferGiftCard(
            giftCardId, recipient1.identity,
            permission.v, permission.r, permission.s,
            { from: altAddress }
          )
            .then(() => assert.fail('transferred GiftCard from non-raindrop address', 'transaction should fail'))
            .catch(error => assert.include(error.message, 'Transfer was not approved from the clientRaindrop address', 'unexpected error'))
        })

      })

      describe("refunds", async () => {
        it("vendor can refund GiftCard balance to customer's snowflake", async function () {
          let originalEscrowBalance = await instances.PhoenixToken.balanceOf(instances.PhoenixGiftCard.address)

          buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)

          let newEscrowBalance = await instances.PhoenixToken.balanceOf(instances.PhoenixGiftCard.address)
          assert(newEscrowBalance.gt(originalEscrowBalance))
          assert(newEscrowBalance.eq(originalEscrowBalance.add(web3.utils.toBN(offerAmounts[0]))))

          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]

          let originalDeposit = web3.utils.toBN(await instances.Snowflake.deposits(customer1.identity, { from: customer1.address }))

          // Initiate the refund
          await instances.PhoenixGiftCard.refundGiftCard(giftCardId, { from: vendor1.address })

          // Confirm refund zeroed out the GiftCard
          let giftCardBalance = web3.utils.toBN(await instances.PhoenixGiftCard.getGiftCardBalance(giftCardId, { from: vendor1.address }))
          assert(giftCardBalance.eq(web3.utils.toBN("0")))

          // Verify that the refunded PHNX landed in the customer's snowflake
          let newDeposit = web3.utils.toBN(await instances.Snowflake.deposits(customer1.identity, { from: customer1.address }))
          assert(newDeposit.gt(originalDeposit), "Refund did not get deposited in snowflake")
          assert(newDeposit.eq(originalDeposit.add(web3.utils.toBN(offerAmounts[0]))), "Deposit in snowflake does not match expected refund")
        })

        it("vendor can't refund an invalid giftCardId", async function () {
          let giftCardId = 123456

          // Initiate the refund
          await instances.PhoenixGiftCard.refundGiftCard(giftCardId, { from: vendor1.address })
            .then(() => assert.fail("vendor refunded a GiftCard with an invalid giftCardId", 'transaction should fail'))
            .catch(error => assert.include(error.message, "Invalid giftCardId", 'unexpected error'))
        })

        it("vendor can't refund a GiftCard they didn't issue", async function () {
          buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], customer1.address)
          let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
          assert(giftCardIds.length > 0, "Customer1 doesn't have any GiftCards")
          let giftCardId = giftCardIds[giftCardIds.length - 1]

          // Initiate the refund -- from the *wrong* vendor
          await instances.PhoenixGiftCard.refundGiftCard(giftCardId, { from: vendor2.address })
            .then(() => assert.fail("vendor refunded a GiftCard they didn't issue", 'transaction should fail'))
            .catch(error => assert.include(error.message, "You don't have permission to refund this gift card", 'unexpected error'))

          // Confirm refund was not processed
          let giftCardBalance = web3.utils.toBN(await instances.PhoenixGiftCard.getGiftCardBalance(giftCardId, { from: vendor1.address }))
          assert(giftCardBalance.eq(web3.utils.toBN(offerAmounts[0])))
        })

      })
    })

    describe("redeem actions", async () => {
      it("Recipient can redeem value at vendor", async function () {
        // Recipien1 should already have a GiftCard
        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
        assert(giftCardIds.length > 0, "Recipient1 doesn't have any GiftCards")
        let giftCardId = giftCardIds[0]

        // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
        let details = await instances.PhoenixGiftCard.getGiftCard(giftCardId)
        let origBalance = details[2]

        assert(origBalance.eq(web3.utils.toBN(offerAmounts[0])), "Balance did not match")

        const amount = origBalance.div(web3.utils.toBN(5))
        const timestamp = Math.round(new Date() / 1000) - 1
        const permission = await signRedeem(giftCardId, amount, timestamp, recipient1)

        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )

        // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
        details = await instances.PhoenixGiftCard.getGiftCard(giftCardId)
        let curBalance = details[2]
        assert(origBalance.gt(curBalance), "GiftCard origBalance is not greater than curBalance")
        assert((origBalance.sub(amount)).eq(curBalance), "GiftCard curBalance is incorrect")
      })

      it("Recipient can't redeem more than GiftCard's balance", async function () {
        // Recipient1 should already have a GiftCard
        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
        assert(giftCardIds.length > 0, "Recipient1 doesn't have any GiftCards")
        let giftCardId = giftCardIds[0]

        // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
        let details = await instances.PhoenixGiftCard.getGiftCard(giftCardId)
        let origBalance = details[2]

        const amount = origBalance.mul(web3.utils.toBN(5))
        const timestamp = Math.round(new Date() / 1000) - 1
        const permission = await signRedeem(giftCardId, amount, timestamp, recipient1)

        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )
          .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Can't redeem more than gift card's balance", 'unexpected error'))
      })

      it("Recipient can't redeem with a malformed signature", async function () {
        // Recipient1 should already have a GiftCard
        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
        assert(giftCardIds.length > 0, "Recipient1 doesn't have any GiftCards")
        let giftCardId = giftCardIds[0]

        const amount = 1000
        const timestamp = Math.round(new Date() / 1000) - 1

        // mix up the parameter order
        let permissionString = web3.utils.soliditySha3(
          '0x19', '0x00', instances.PhoenixGiftCard.address,
          'I authorize the redemption of this gift card.',
          amount,
          giftCardId,
          timestamp
        )
        let permission = await sign(permissionString, recipient1.address, recipient1.private)

        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )
          .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Permission denied", 'unexpected error'))

        // Omit timestamp
        permissionString = web3.utils.soliditySha3(
          '0x19', '0x00', instances.PhoenixGiftCard.address,
          'I authorize the redemption of this gift card.',
          giftCardId,
          amount
        )
        permission = await sign(permissionString, recipient1.address, recipient1.private)
        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )
          .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Permission denied", 'unexpected error'))

          // mismatached amount
          permissionString = web3.utils.soliditySha3(
            '0x19', '0x00', instances.PhoenixGiftCard.address,
            'I authorize the redemption of this gift card.',
            giftCardId,
            amount,
            timestamp
          )
          permission = await sign(permissionString, recipient1.address, recipient1.private)
          await instances.PhoenixGiftCard.redeem(
            giftCardId, amount*2, timestamp,
            permission.v, permission.r, permission.s,
            { from: recipient1.address }
          )
            .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
            .catch(error => assert.include(error.message, "Permission denied", 'unexpected error'))

            // mismatached giftCardId
            permissionString = web3.utils.soliditySha3(
              '0x19', '0x00', instances.PhoenixGiftCard.address,
              'I authorize the redemption of this gift card.',
              giftCardId,
              amount,
              timestamp
            )
            permission = await sign(permissionString, recipient1.address, recipient1.private)
            await instances.PhoenixGiftCard.redeem(
              giftCardId.add(web3.utils.toBN("1")), amount, timestamp,
              permission.v, permission.r, permission.s,
              { from: recipient1.address }
            )
              .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
              .catch(error => assert.include(error.message, "Permission denied", 'unexpected error'))
      })

      it("Recipient can't redeem an empty GiftCard", async function () {
        // Recipient1 should already have a GiftCard
        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
        assert(giftCardIds.length > 0, "Recipient1 doesn't have any GiftCards")
        let giftCardId = giftCardIds[0]

        // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
        let details = await instances.PhoenixGiftCard.getGiftCard(giftCardId)
        let origBalance = details[2]

        let amount = origBalance
        let timestamp = Math.round(new Date() / 1000) - 1
        let permission = await signRedeem(giftCardId, amount, timestamp, recipient1)

        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )

        // returns (string memory vendorCasedPhoenixID, string memory customerCasedPhoenixID, uint balance)
        details = await instances.PhoenixGiftCard.getGiftCard(giftCardId)
        let curBalance = details[2]
        assert(curBalance.eq(web3.utils.toBN('0')), "GiftCard balance should be zero")

        amount = 1000
        timestamp = Math.round(new Date() / 1000) - 1
        permission = await signRedeem(giftCardId, amount, timestamp, recipient1)

        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )
          .then(() => assert.fail("redeemed more than the GiftCard's balance", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Can't redeem an empty gift card", 'unexpected error'))
      })

      it("Recipient can't redeem invalid GiftCard ID", async function () {
        const giftCardId = 123456
        const amount = 1000
        const timestamp = Math.round(new Date() / 1000) - 1
        const permission = await signRedeem(giftCardId, amount, timestamp, recipient1)
        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient1.address }
        )
          .then(() => assert.fail("redeemed an invalid giftCardId", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Invalid giftCardId", 'unexpected error'))
      })

      it("Recipient can't redeem a GiftCard they don't own", async function () {
        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: recipient1.address })
        assert(giftCardIds.length > 0, "Recipient1 doesn't have any GiftCards")
        let giftCardId = giftCardIds[0]

        const amount = 1000
        const timestamp = Math.round(new Date() / 1000) - 1

        // Recipient2 will try to redeem it
        const permission = await signRedeem(giftCardId, amount, timestamp, recipient2)
        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: recipient2.address }
        )
          .then(() => assert.fail("redeemed a GiftCard the user didn't own", 'transaction should fail'))
          .catch(error => assert.include(error.message, "You aren't the owner of this gift card", 'unexpected error'))
      })

      it("Recipient can't redeem a GiftCard from a non-raindrop address", async function () {
        // Add a new address to the buyer's identity
        const altAddress = {
          address: accounts[9],
          private: "0xce5e2ea9c47caba88b3421d75023bd8c359e2aaf897e519a10a256d931028ca1"
        }
        let timestamp = Math.round(new Date() / 1000) - 1
        const addAddrPermissionString = web3.utils.soliditySha3(
          '0x19', '0x00', instances.IdentityRegistry.address,
          'I authorize adding this address to my Identity.',
          recipient2.identity, altAddress.address, timestamp
        )
        const addAddrPermission = await sign(addAddrPermissionString, recipient2.address, recipient2.private);
        await instances.IdentityRegistry.addAssociatedAddress(
          recipient2.address, altAddress.address,
          addAddrPermission.v, addAddrPermission.r, addAddrPermission.s,
          timestamp,
          { from: altAddress.address }
        )

        // confirm
        assert(await instances.IdentityRegistry.isAssociatedAddressFor(recipient2.identity, altAddress.address), "Newly added address was not associated with EIN")

        buyGiftCard(vendor1.identity.toNumber(), offerAmounts[0], recipient2.address)

        let giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: altAddress.address })
        assert(giftCardIds.length > 0, "recipient2 doesn't have any GiftCards")
        let giftCardId = giftCardIds[giftCardIds.length-1]

        const amount = 1000
        timestamp = Math.round(new Date() / 1000) - 1

        // recipient2 will try to redeem it from their new address instead of their raindrop addr
        const permission = await signRedeem(giftCardId, amount, timestamp, altAddress)
        await instances.PhoenixGiftCard.redeem(
          giftCardId, amount, timestamp,
          permission.v, permission.r, permission.s,
          { from: altAddress.address }
        )
          .then(() => assert.fail("redeemed a GiftCard from a non-raindrop address", 'transaction should fail'))
          .catch(error => assert.include(error.message, "Redeem was not approved from the clientRaindrop address", 'unexpected error'))
      })
    })

  })

  describe("Test VendorSampleContract", async () => {
    it("Vendor's smart contract can automatically redeem authorized GiftCard funds", async function () {
      const amount = offerAmounts[0]
      await buyGiftCard(vendor1.identity.toNumber(), amount, customer1.address)
      const giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
      const giftCardId = giftCardIds[giftCardIds.length - 1]

      const redeemAmount = web3.utils.toBN(amount).div(web3.utils.toBN("5"))
      const vendorInvoiceId = 12345

      let originalDeposit = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))

      const timestamp = Math.round(new Date() / 1000) - 1
      const permission = await signRedeem(giftCardId, redeemAmount, timestamp, customer1)
      await instances.PhoenixGiftCard.redeemAndCall(
        giftCardId, redeemAmount, timestamp,
        permission.v, permission.r, permission.s,
        instances.VendorSampleContract.address, web3.eth.abi.encodeParameter('uint256', vendorInvoiceId),
        { from: customer1.address }
      )

      let newDeposit = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))
      assert(newDeposit.eq(originalDeposit.add(web3.utils.toBN(redeemAmount))), "Vendor did not receive the PHNX funds into their snowflake")
    })

    it("Vendor can't redeem the same funds twice", async function () {
      const amount = offerAmounts[0]
      await buyGiftCard(vendor1.identity.toNumber(), amount, customer1.address)
      const giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
      const giftCardId = giftCardIds[giftCardIds.length - 1]

      const redeemAmount = web3.utils.toBN(amount).div(web3.utils.toBN("5"))
      const vendorInvoiceId = 12345

      let originalBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))

      const timestamp = Math.round(new Date() / 1000) - 1
      const permission = await signRedeem(giftCardId, redeemAmount, timestamp, customer1)
      await instances.PhoenixGiftCard.redeemAndCall(
        giftCardId, redeemAmount, timestamp,
        permission.v, permission.r, permission.s,
        instances.VendorSampleContract.address, web3.eth.abi.encodeParameter('uint256', vendorInvoiceId),
        { from: customer1.address }
      )

      // Confirm receipt
      let newBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))
      assert(newBalance.eq(originalBalance.add(web3.utils.toBN(redeemAmount))), "Vendor did not receive the PHNX funds into their snowflake")

      // Now manually call vendorRedeem with the same values
      await instances.PhoenixGiftCard.vendorRedeem(giftCardId, redeemAmount)
        .then(() => assert.fail("redeemed an unauthorized amount", 'transaction should fail'))
        .catch(error => assert.include(error.message, "Redemption amount is greater than what is authorized", 'unexpected error'))
    })

    it("Customer can't redeem an invalid giftCardId", async function () {
      const giftCardId = 123456
      const redeemAmount = 10000
      const vendorInvoiceId = 7890

      const timestamp = Math.round(new Date() / 1000) - 1
      const permission = await signRedeem(giftCardId, redeemAmount, timestamp, customer1)
      await instances.PhoenixGiftCard.redeemAndCall(
        giftCardId, redeemAmount, timestamp,
        permission.v, permission.r, permission.s,
        instances.VendorSampleContract.address, web3.eth.abi.encodeParameter('uint256', vendorInvoiceId),
        { from: customer1.address }
      )
        .then(() => assert.fail("redeemed an invalid giftCardId", 'transaction should fail'))
        .catch(error => assert.include(error.message, "Invalid giftCardId", 'unexpected error'))
    })

    it("Redemption only pays out to vendor's EIN address", async function () {
      const VendorSampleContract = artifacts.require('./VendorSampleContract.sol')
      const amount = offerAmounts[0]
      await buyGiftCard(vendor1.identity.toNumber(), amount, customer1.address)
      const giftCardIds = await instances.PhoenixGiftCard.getCustomerGiftCardIds({ from: customer1.address })
      const giftCardId = giftCardIds[giftCardIds.length - 1]

      const vendorInvoiceId = 12345
      const redeemAmount = web3.utils.toBN(amount).div(web3.utils.toBN("5"))

      let vendor1OriginalBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))
      let vendor2OriginalBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor2.identity, { from: vendor2.address }))

      const timestamp = Math.round(new Date() / 1000) - 1
      const permission = await signRedeem(giftCardId, redeemAmount, timestamp, customer1)

      // Vendor2 sets up a phishing contract...
      instances.EvilVendorSampleContract = await VendorSampleContract.new({ from: vendor2.address })
      await instances.EvilVendorSampleContract.setAddresses(instances.ClientRaindrop.address, { from: vendor2.address })

      // ...and fools customer1 into submitting a redemption call to their evil contract
      await instances.PhoenixGiftCard.redeemAndCall(
        giftCardId, redeemAmount, timestamp,
        permission.v, permission.r, permission.s,
        instances.EvilVendorSampleContract.address, web3.eth.abi.encodeParameter('uint256', vendorInvoiceId),
        { from: customer1.address }
      )

      let vendor1NewBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor1.identity, { from: vendor1.address }))
      let vendor2NewBalance = web3.utils.toBN(await instances.Snowflake.deposits(vendor2.identity, { from: vendor2.address }))

      // But it shouldn't matter; the funds will go to vendor1's snowflake regardless
      assert(vendor1NewBalance.eq(vendor1OriginalBalance.add(web3.utils.toBN(redeemAmount))), "Vendor did not receive the PHNX funds in their snowflake")
      assert(vendor2NewBalance.eq(vendor2OriginalBalance), "Vendor2 received the PHNX funds it shouldn't have had access to")
    })
  })
})
