const TimelockProxy = artifacts.require("TimelockProxy");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const MockERC20 = artifacts.require("MockERC20");
const SwapCenter = artifacts.require("SwapCenter");
const InsuranceVaultUpgradeable = artifacts.require("InsuranceVaultUpgradeable");
const TimelockRegistryUpgradeable = artifacts.require("TimelockRegistryUpgradeable");
const SelfCompoundingYieldUpgradeable = artifacts.require("SelfCompoundingYieldUpgradeable");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const StakingMultiRewardsUpgradeable = artifacts.require("StakingMultiRewardsUpgradeable");

const {usdc, weth} = require("./eth-address.js");

async function store(admin, proxyAdmin) {
  storageImplementation = await StorageV1Upgradeable.new();
  storageInitCall = web3.eth.abi.encodeFunctionCall({
    name: 'initialize',
    type: 'function',
    inputs: [{
      type: 'address',
      name: '_governance'
    }, {
      type: 'address',
      name: '_proxyAdmin'
    }]
  }, [admin, proxyAdmin]);

  let storeProxy = await TimelockProxy.new(
    storageImplementation.address,
    proxyAdmin, // owner of proxy
    0,    // no timelock
    storageInitCall,
    {from: admin}
  );

  return (await StorageV1Upgradeable.at(storeProxy.address));
}

async function timelockRegistry(storeAddr, admin, proxyAdmin) {
  timelockImplementation = await TimelockRegistryUpgradeable.new();
  proxy = await TimelockProxyStorageCentered.new(
    timelockImplementation.address,
    storeAddr, 
    0,    // no timelock
    "0x",
    {from: admin}
  );

  timelock = await TimelockRegistryUpgradeable.at(proxy.address);
  await timelock.initialize(storeAddr, {from: admin});

  storeContract = await StorageV1Upgradeable.at(storeAddr);
  await storeContract.setRegistry(timelock.address, {from: admin});
  return timelock; 
}

async function vaultWithMsnx(storeAddr, baseAddr, longAddr, admin, proxyAdmin, cap="1000000000"+"0".repeat(18), duration=86400, selfCompoundingLongAddr=false) {
  vaultImplmentation = await VaultUpgradeable.new();
  vaultInitCall = web3.eth.abi.encodeFunctionCall({
    name: 'initialize',
    type: 'function',
    inputs: [{
      type: 'address',
      name: 'storage'
    },{
      type: 'address',
      name: 'base'
    },{
      type: 'address',
      name: 'long'
    },{
      type: 'uint256',
      name: 'cap'
    },]
  }, [storeAddr, baseAddr, longAddr, cap]);

  let vaultProxy = await TimelockProxyStorageCentered.new(
    vaultImplmentation.address,
    storeAddr,
    0,    // no timelock
    vaultInitCall,
    {from: admin}
  );

  let vault = await VaultUpgradeable.at(vaultProxy.address);
  let msnxImplementation = await StakingMultiRewardsUpgradeable.new();
  let msnxProxy = await TimelockProxyStorageCentered.new(
    msnxImplementation.address,
    storeAddr,
    0,
    "0x",
    {from: admin}
  );
  msnx = await StakingMultiRewardsUpgradeable.at(msnxProxy.address);

  if(selfCompoundingLongAddr == false) {
    await msnx.initialize(
      storeAddr,
      admin,
      vault.address,
      longAddr,
      duration,
      false,
      {from: admin}
    );
  } else {
    await msnx.initialize(
      storeAddr,
      admin,
      vault.address,
      selfCompoundingLongAddr,
      duration,
      true,
      {from: admin}
    );  
  }

  await vault.setRewardPool(msnx.address, {from: admin});

  return [vault, msnx];
}

async function insuranceVaultWithMsnx(storeAddr, baseAddr, longAddr, admin, proxyAdmin, cap="1000000000"+"0".repeat(18), duration=86400, isSelfCompounding=false) {
  vaultImplmentation = await InsuranceVaultUpgradeable.new();
  vaultInitCall = web3.eth.abi.encodeFunctionCall({
    name: 'initialize',
    type: 'function',
    inputs: [{
      type: 'address',
      name: 'storage'
    },{
      type: 'address',
      name: 'base'
    },{
      type: 'address',
      name: 'long'
    },{
      type: 'uint256',
      name: 'cap'
    },]
  }, [storeAddr, baseAddr, longAddr, cap]);

  let vaultProxy = await TimelockProxyStorageCentered.new(
    vaultImplmentation.address,
    storeAddr,
    0,    // no timelock
    vaultInitCall,
    {from: admin}
  );

  let vault = await InsuranceVaultUpgradeable.at(vaultProxy.address);

  let msnxImplementation = await StakingMultiRewardsUpgradeable.new();
  let msnxProxy = await TimelockProxyStorageCentered.new(
    msnxImplementation.address,
    storeAddr,
    0,
    "0x",
    {from: admin}
  );
  msnx = await StakingMultiRewardsUpgradeable.at(msnxProxy.address);
  await msnx.initialize(
    storeAddr,
    admin,
    vault.address,
    longAddr,
    duration,
    isSelfCompounding,
    {from: admin}
  );

  await vault.setRewardPool(msnx.address, {from: admin});

  return [vault, msnx];
}

async function selfCompoundingYield(storeAddr, baseAddr, admin, proxyAdmin) {
  scYieldImplementation = await SelfCompoundingYieldUpgradeable.new();
  scYieldInitCall = web3.eth.abi.encodeFunctionCall({
    name: 'initialize',
    type: 'function',
    inputs: [{
      type: 'address',
      name: 'storage'
    },{
      type: 'address',
      name: 'base'
    }]
  }, [storeAddr, baseAddr]);

  let scYieldProxy = await TimelockProxyStorageCentered.new(
    scYieldImplementation.address,
    storeAddr, // owner of proxy
    0,    // no timelock
    scYieldInitCall,
    {from: admin}
  );

  let scYield = await SelfCompoundingYieldUpgradeable.at(scYieldProxy.address);

  return scYield;
}

async function swapCenter(store, admin) {
  swapCenter = await SwapCenter.new({from: admin});
  await store.setSwapCenter(swapCenter.address, {from: admin});

  // Set routes that are often used.

  // USDC to WETH
  await swapCenter.setRoute(
    usdc,
    weth,
    [0],
    [
      [usdc, weth]
    ], {from: admin}
  );
  return swapCenter;
}

module.exports = {
  store,
  timelockRegistry,
  vaultWithMsnx,
  insuranceVaultWithMsnx,
  selfCompoundingYield,
  swapCenter
};