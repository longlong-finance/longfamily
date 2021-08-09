// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;
import "@openzeppelin/contracts/proxy/Proxy.sol";
import "./utilities/UnstructuredStorageWithTimelock.sol";

/**
    TimelockProxy is a proxy implementation that timelocks the implementation switch.
    The owner is stored in the contract storage of this proxy.
*/
contract TimelockProxy is Proxy {
    using UnstructuredStorageWithTimelock for bytes32;

    // bytes32(uint256(keccak256("eip1967.proxy.owner")) - 1
    bytes32 private constant _OWNER_SLOT =
        0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a;

    // bytes32(uint256(keccak256("eip1967.proxy.timelock")) - 1
    bytes32 private constant _TIMELOCK_SLOT =
        0xc6fb23975d74c7743b6d6d0c1ad9dc3911bc8a4a970ec5723a30579b45472009;

    // _IMPLEMENTATION_SLOT, value cloned from UpgradeableProxy
    bytes32 private constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    event UpgradeScheduled(address indexed implementation, uint256 activeTime);
    event Upgraded(address indexed implementation);

    event OwnershipTransferScheduled(
        address indexed newOwner,
        uint256 activeTime
    );
    event OwnershipTransfered(address indexed newOwner);

    event TimelockUpdateScheduled(uint256 newTimelock, uint256 activeTime);
    event TimelockUpdated(uint256 newTimelock);

    constructor(
        address _logic,
        address _owner,
        uint256 _timelock,
        bytes memory _data
    ) {
        assert(
            _OWNER_SLOT ==
                bytes32(uint256(keccak256("eip1967.proxy.owner")) - 1)
        );
        assert(
            _TIMELOCK_SLOT ==
                bytes32(uint256(keccak256("eip1967.proxy.timelock")) - 1)
        );
        assert(
            _IMPLEMENTATION_SLOT ==
                bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
        );
        _OWNER_SLOT.setAddress(_owner);
        _TIMELOCK_SLOT.setUint256(_timelock);
        _IMPLEMENTATION_SLOT.setAddress(_logic);
        if (_data.length > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = _logic.delegatecall(_data);
            require(success);
        }
    }

    // Using Transparent proxy pattern to avoid collision attacks
    // see OpenZeppelin's `TransparentUpgradeableProxy`
    modifier ifProxyOwner() {
        if (msg.sender == _OWNER_SLOT.fetchAddress()) {
            _;
        } else {
            _fallback();
        }
    }

    modifier requireTimelockPassed(bytes32 _slot) {
        require(
            block.timestamp >= _slot.scheduledTime(),
            "Timelock has not passed yet"
        );
        _;
    }

    function proxyScheduleAddressUpdate(bytes32 _slot, address targetAddress)
        public
        ifProxyOwner
    {
        uint256 activeTime = block.timestamp + _TIMELOCK_SLOT.fetchUint256();
        (_slot.scheduledContentSlot()).setAddress(targetAddress);
        (_slot.scheduledTimeSlot()).setUint256(activeTime);

        if (_slot == _IMPLEMENTATION_SLOT) {
            emit UpgradeScheduled(targetAddress, activeTime);
        } else if (_slot == _OWNER_SLOT) {
            emit OwnershipTransferScheduled(targetAddress, activeTime);
        }
    }

    function proxyScheduleTimelockUpdate(uint256 newTimelock) public ifProxyOwner {
        uint256 activeTime = block.timestamp + _TIMELOCK_SLOT.fetchUint256();
        (_TIMELOCK_SLOT.scheduledContentSlot()).setUint256(newTimelock);
        (_TIMELOCK_SLOT.scheduledTimeSlot()).setUint256(activeTime);

        emit TimelockUpdateScheduled(newTimelock, activeTime);
    }

    function proxyUpgradeTimelock()
        public
        ifProxyOwner
        requireTimelockPassed(_TIMELOCK_SLOT)
    {
        uint256 newTimelock =
            (_TIMELOCK_SLOT.scheduledContentSlot()).fetchUint256();
        _TIMELOCK_SLOT.setUint256(newTimelock);
        emit TimelockUpdated(newTimelock);
    }

    function proxyUpgradeImplementation()
        public
        ifProxyOwner
        requireTimelockPassed(_IMPLEMENTATION_SLOT)
    {
        address newImplementation =
            (_IMPLEMENTATION_SLOT.scheduledContentSlot()).fetchAddress();
        _IMPLEMENTATION_SLOT.setAddress(newImplementation);
        emit Upgraded(newImplementation);
    }

    function proxyUpgradeOwner()
        public
        ifProxyOwner
        requireTimelockPassed(_OWNER_SLOT)
    {
        address newOwner = (_OWNER_SLOT.scheduledContentSlot()).fetchAddress();
        _OWNER_SLOT.setAddress(newOwner);
        emit OwnershipTransfered(newOwner);
    }

    function _implementation() internal view override returns (address impl) {
        bytes32 slot = _IMPLEMENTATION_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            impl := sload(slot)
        }
    }
}
