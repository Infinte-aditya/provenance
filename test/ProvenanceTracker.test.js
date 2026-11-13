const { expect } = require("chai");
const { ethers } = require("hardhat");

const Role = { None: 0, Producer: 1, Transporter: 2, Warehouse: 3, Retailer: 4 };
const Status = { Created: 0, InTransit: 1, InWarehouse: 2, AtRetailer: 3, Delivered: 4, Recalled: 5 };
const ZERO_HASH = ethers.ZeroHash;
const HASH = ethers.sha256(ethers.toUtf8Bytes("certificate"));

describe("ProvenanceTracker", () => {
  let c, owner, farmer, trucker, warehouse, shop, stranger;

  // helpers: full handover = initiate + accept
  const handover = async (id, from, to, loc = "Somewhere", note = "", ev = ZERO_HASH) => {
    await c.connect(from).initiateTransfer(id, to.address, loc, note, ev);
    await c.connect(to).acceptTransfer(id);
  };
  const ids = async (p) => (await p).map(Number);

  beforeEach(async () => {
    [owner, farmer, trucker, warehouse, shop, stranger] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("ProvenanceTracker")).deploy();
    await c.setParticipant(farmer.address, Role.Producer, "Farm");
    await c.setParticipant(trucker.address, Role.Transporter, "Truck");
    await c.setParticipant(warehouse.address, Role.Warehouse, "Warehouse");
    await c.setParticipant(shop.address, Role.Retailer, "Shop");
  });

  describe("participants (admin)", () => {
    it("only the owner can add, remove, pause or transfer ownership", async () => {
      const s = c.connect(stranger);
      await expect(s.setParticipant(stranger.address, Role.Producer, "X")).to.be.revertedWithCustomError(c, "NotOwner");
      await expect(s.removeParticipant(farmer.address)).to.be.revertedWithCustomError(c, "NotOwner");
      await expect(s.pause()).to.be.revertedWithCustomError(c, "NotOwner");
      await expect(s.transferOwnership(stranger.address)).to.be.revertedWithCustomError(c, "NotOwner");
    });
    it("validates role, address and name", async () => {
      await expect(c.setParticipant(stranger.address, Role.None, "X")).to.be.revertedWithCustomError(c, "InvalidRole");
      await expect(c.setParticipant(ethers.ZeroAddress, Role.Producer, "X")).to.be.revertedWithCustomError(c, "InvalidAddress");
      await expect(c.setParticipant(stranger.address, Role.Producer, "")).to.be.revertedWithCustomError(c, "EmptyString");
    });
    it("lists participants and allows role changes without duplicates", async () => {
      await c.setParticipant(trucker.address, Role.Warehouse, "Truck renamed");
      const list = await c.getParticipants();
      expect(list.length).to.equal(4);
      const t = list.find((p) => p.account === trucker.address);
      expect(Number(t.role)).to.equal(Role.Warehouse);
      expect(t.name).to.equal("Truck renamed");
    });
    it("a removed participant can no longer act, and can be reactivated", async () => {
      await c.connect(farmer).registerProduct("Rice", "Farm");
      await c.removeParticipant(farmer.address);
      expect((await c.participantOf(farmer.address)).active).to.equal(false);
      await expect(c.connect(farmer).registerProduct("Rice2", "Farm")).to.be.revertedWithCustomError(c, "NotAuthorized");
      await expect(c.connect(farmer).initiateTransfer(1, trucker.address, "X", "", ZERO_HASH))
        .to.be.revertedWithCustomError(c, "NotAuthorized");
      await c.setParticipant(farmer.address, Role.Producer, "Farm");
      await c.connect(farmer).registerProduct("Rice2", "Farm");
    });
    it("cannot remove an unknown address", async () => {
      await expect(c.removeParticipant(stranger.address)).to.be.revertedWithCustomError(c, "NotRegistered");
    });
    it("ownership can be transferred", async () => {
      await c.transferOwnership(stranger.address);
      expect(await c.owner()).to.equal(stranger.address);
      await expect(c.setParticipant(stranger.address, Role.Producer, "X")).to.be.revertedWithCustomError(c, "NotOwner");
    });
  });

  describe("registration and enumeration", () => {
    it("only active producers can register", async () => {
      await expect(c.connect(trucker).registerProduct("Rice", "Farm")).to.be.revertedWithCustomError(c, "NotAuthorized");
      await expect(c.connect(stranger).registerProduct("Rice", "Farm")).to.be.revertedWithCustomError(c, "NotAuthorized");
    });
    it("validates strings and unknown ids", async () => {
      await expect(c.connect(farmer).registerProduct("", "x")).to.be.revertedWithCustomError(c, "EmptyString");
      await expect(c.connect(farmer).registerProduct("a".repeat(129), "x")).to.be.revertedWithCustomError(c, "StringTooLong");
      await expect(c.getProduct(0)).to.be.revertedWithCustomError(c, "UnknownProduct");
      await expect(c.getProduct(5)).to.be.revertedWithCustomError(c, "UnknownProduct");
    });
    it("lists products by producer and by custodian, staying correct after handovers", async () => {
      for (const n of ["A", "B", "C"]) await c.connect(farmer).registerProduct(n, "Farm");
      expect(await ids(c.productsMadeBy(farmer.address))).to.have.members([1, 2, 3]);
      expect(await ids(c.productsHeldBy(farmer.address))).to.have.members([1, 2, 3]);

      await handover(1, farmer, trucker); // removes the first element (swap-and-pop)
      expect(await ids(c.productsHeldBy(farmer.address))).to.have.members([2, 3]);
      expect(await ids(c.productsHeldBy(trucker.address))).to.deep.equal([1]);
      expect(await ids(c.productsMadeBy(farmer.address))).to.have.members([1, 2, 3]);

      await handover(3, farmer, trucker);
      expect(await ids(c.productsHeldBy(farmer.address))).to.deep.equal([2]);
      expect(await ids(c.productsHeldBy(trucker.address))).to.have.members([1, 3]);
    });
  });

  describe("two-step handover", () => {
    beforeEach(async () => {
      await c.connect(farmer).registerProduct("Rice", "Farm");
    });

    it("initiating does not move custody until accepted", async () => {
      await expect(c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "Loaded", HASH))
        .to.emit(c, "TransferInitiated").withArgs(1, farmer.address, trucker.address);
      expect((await c.getProduct(1)).custodian).to.equal(farmer.address);
      expect((await c.pendingTransfer(1)).to).to.equal(trucker.address);
      expect(await ids(c.incomingFor(trucker.address))).to.deep.equal([1]);
      expect(Number(await c.getHistory(1).then((h) => h.length))).to.equal(1);
    });

    it("accepting moves custody, sets status by role, and records note and evidence", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "Loaded", HASH);
      await expect(c.connect(trucker).acceptTransfer(1)).to.emit(c, "CustodyTransferred").withArgs(1, farmer.address, trucker.address);
      const p = await c.getProduct(1);
      expect(p.custodian).to.equal(trucker.address);
      expect(Number(p.status)).to.equal(Status.InTransit);
      const h = await c.getHistory(1);
      expect(h[1].handler).to.equal(trucker.address);
      expect(h[1].location).to.equal("Gate");
      expect(h[1].note).to.equal("Loaded");
      expect(h[1].evidence).to.equal(HASH);
      expect(await ids(c.incomingFor(trucker.address))).to.deep.equal([]);
      expect((await c.pendingTransfer(1)).to).to.equal(ethers.ZeroAddress);
    });

    it("only the named receiver can accept", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await expect(c.connect(warehouse).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NotReceiver");
      await expect(c.connect(farmer).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NotReceiver");
    });

    it("accept fails when nothing is pending", async () => {
      await expect(c.connect(trucker).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NoPendingTransfer");
    });

    it("only the custodian can initiate or cancel", async () => {
      await expect(c.connect(trucker).initiateTransfer(1, shop.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "NotCustodian");
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await expect(c.connect(trucker).cancelTransfer(1)).to.be.revertedWithCustomError(c, "NotCustodian");
    });

    it("the custodian can cancel; the receiver can then not accept", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await expect(c.connect(farmer).cancelTransfer(1)).to.emit(c, "TransferCancelled");
      expect(await ids(c.incomingFor(trucker.address))).to.deep.equal([]);
      await expect(c.connect(trucker).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NoPendingTransfer");
      await expect(c.connect(farmer).cancelTransfer(1)).to.be.revertedWithCustomError(c, "NoPendingTransfer");
    });

    it("blocks other actions while a handover is pending", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await expect(c.connect(farmer).initiateTransfer(1, shop.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "TransferPending");
      await expect(c.connect(farmer).addCheckpoint(1, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "TransferPending");
    });

    it("rejects invalid recipients", async () => {
      await expect(c.connect(farmer).initiateTransfer(1, stranger.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "NotRegistered");
      await expect(c.connect(farmer).initiateTransfer(1, farmer.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "InvalidAddress");
      await expect(c.connect(farmer).initiateTransfer(1, ethers.ZeroAddress, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "InvalidAddress");
      await expect(c.connect(farmer).initiateTransfer(1, trucker.address, "", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "EmptyString");
    });

    it("cannot be accepted by a receiver who was deactivated in the meantime", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await c.removeParticipant(trucker.address);
      await expect(c.connect(trucker).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NotRegistered");
    });
  });

  describe("checkpoints and delivery", () => {
    beforeEach(async () => {
      await c.connect(farmer).registerProduct("Rice", "Farm");
      await handover(1, farmer, trucker);
    });

    it("custodian can add a checkpoint with an evidence hash", async () => {
      await expect(c.connect(trucker).addCheckpoint(1, "Trichy", "On time", HASH)).to.emit(c, "CheckpointAdded");
      const h = await c.getHistory(1);
      expect(h[h.length - 1].evidence).to.equal(HASH);
      expect(Number(h[h.length - 1].status)).to.equal(Status.InTransit);
    });

    it("non-custodians cannot add checkpoints", async () => {
      await expect(c.connect(farmer).addCheckpoint(1, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "NotCustodian");
    });

    it("only a retailer can confirm delivery, and that seals the record", async () => {
      await expect(c.connect(trucker).confirmDelivery(1, "X", ZERO_HASH)).to.be.revertedWithCustomError(c, "NotAuthorized");
      await handover(1, trucker, shop, "Store");
      expect(Number((await c.getProduct(1)).status)).to.equal(Status.AtRetailer);
      await c.connect(shop).confirmDelivery(1, "Store shelf", HASH);
      expect(Number((await c.getProduct(1)).status)).to.equal(Status.Delivered);
      await expect(c.connect(shop).addCheckpoint(1, "X", "late edit", ZERO_HASH)).to.be.revertedWithCustomError(c, "ProductClosed");
      await expect(c.connect(shop).initiateTransfer(1, warehouse.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "ProductClosed");
      await expect(c.connect(farmer).recall(1, "too late")).to.be.revertedWithCustomError(c, "ProductClosed");
    });
  });

  describe("recall", () => {
    beforeEach(async () => {
      await c.connect(farmer).registerProduct("Rice", "Farm");
    });

    it("producer or owner can recall; others cannot", async () => {
      await expect(c.connect(stranger).recall(1, "x")).to.be.revertedWithCustomError(c, "NotAuthorized");
      await expect(c.connect(trucker).recall(1, "x")).to.be.revertedWithCustomError(c, "NotAuthorized");
      await expect(c.connect(farmer).recall(1, "Contamination")).to.emit(c, "ProductRecalled");
      expect(Number((await c.getProduct(1)).status)).to.equal(Status.Recalled);
    });

    it("owner can recall any product, and a reason is required", async () => {
      await expect(c.recall(1, "")).to.be.revertedWithCustomError(c, "EmptyString");
      await c.recall(1, "Regulator order");
      const h = await c.getHistory(1);
      expect(h[h.length - 1].note).to.equal("Regulator order");
    });

    it("recall clears a pending handover and freezes the record", async () => {
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await c.connect(farmer).recall(1, "Contamination");
      expect(await ids(c.incomingFor(trucker.address))).to.deep.equal([]);
      await expect(c.connect(trucker).acceptTransfer(1)).to.be.revertedWithCustomError(c, "NoPendingTransfer");
      await expect(c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "ProductClosed");
    });

    it("a deactivated producer cannot recall, but the owner can", async () => {
      await c.removeParticipant(farmer.address);
      await expect(c.connect(farmer).recall(1, "x")).to.be.revertedWithCustomError(c, "NotAuthorized");
      await c.recall(1, "Admin recall");
    });
  });

  describe("emergency pause", () => {
    beforeEach(async () => {
      await c.connect(farmer).registerProduct("Rice", "Farm");
      await c.connect(farmer).initiateTransfer(1, trucker.address, "Gate", "", ZERO_HASH);
      await expect(c.pause()).to.emit(c, "Paused");
    });

    it("freezes all product operations", async () => {
      expect(await c.paused()).to.equal(true);
      await expect(c.connect(farmer).registerProduct("B", "Farm")).to.be.revertedWithCustomError(c, "ContractPaused");
      await expect(c.connect(trucker).acceptTransfer(1)).to.be.revertedWithCustomError(c, "ContractPaused");
      await expect(c.connect(farmer).cancelTransfer(1)).to.be.revertedWithCustomError(c, "ContractPaused");
      await expect(c.connect(farmer).initiateTransfer(1, shop.address, "X", "", ZERO_HASH)).to.be.revertedWithCustomError(c, "ContractPaused");
      await expect(c.pause()).to.be.revertedWithCustomError(c, "ContractPaused");
    });

    it("still allows recalls, admin changes and reads", async () => {
      await c.setParticipant(stranger.address, Role.Retailer, "New shop");
      await c.recall(1, "Safety recall during pause");
      expect(Number((await c.getProduct(1)).status)).to.equal(Status.Recalled);
    });

    it("resumes after unpause", async () => {
      await expect(c.connect(stranger).unpause()).to.be.revertedWithCustomError(c, "NotOwner");
      await c.unpause();
      await c.connect(trucker).acceptTransfer(1);
      await expect(c.unpause()).to.be.revertedWithCustomError(c, "NotPaused");
    });
  });

  describe("full lifecycle", () => {
    it("tracks a product from farm to shelf with a complete trail", async () => {
      await c.connect(farmer).registerProduct("Basmati Rice", "Thanjavur Farm");
      await handover(1, farmer, trucker, "Thanjavur", "Loaded", HASH);
      await c.connect(trucker).addCheckpoint(1, "Trichy toll", "On schedule", ZERO_HASH);
      await handover(1, trucker, warehouse, "Chennai DC");
      await handover(1, warehouse, shop, "T Nagar Store");
      await c.connect(shop).confirmDelivery(1, "T Nagar Store", ZERO_HASH);

      const h = await c.getHistory(1);
      expect(h.length).to.equal(6);
      expect(h.map((x) => Number(x.status))).to.deep.equal([
        Status.Created, Status.InTransit, Status.InTransit, Status.InWarehouse, Status.AtRetailer, Status.Delivered,
      ]);
      expect((await c.getProduct(1)).custodian).to.equal(shop.address);
      expect(await ids(c.productsHeldBy(shop.address))).to.deep.equal([1]);
      expect(await ids(c.productsHeldBy(farmer.address))).to.deep.equal([]);
    });
  });
});
