// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Interface of the snarkjs-generated Groth16 verifier (Verifier.sol).
/// The generated contract is named Groth16Verifier and has 3 public signals:
/// [isAboveLimit, currentYear, ageLimit]
interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] calldata _pubSignals
    ) external view returns (bool);
}

/// @title zkKYC
/// @notice Records that a wallet proved "age >= minAge" with a real Groth16 proof.
/// @dev ACADEMIC PROTOTYPE. The proof shows the prover knows a birth year that
///      satisfies the rule. It does NOT prove the birth year is real. A production
///      KYC system needs a trusted issuer to sign the birth year, and the circuit
///      must check that signature.
///      No birth data is stored. Wallet addresses and timestamps are public.
contract zkKYC {
    IGroth16Verifier public immutable verifier;
    address public immutable owner;

    uint256 public constant MIN_AGE = 18;
    uint256 public maxYearDrift = 1; // allowed gap between block year and proof year

    struct Record {
        bool verified;
        uint64 verifiedAt;
        uint32 proofYear;
        uint32 count;
    }

    mapping(address => Record) private records;
    // Each proof can be used once, so a copied proof cannot be replayed by others.
    mapping(bytes32 => bool) public usedProofs;

    event AgeVerified(address indexed user, uint256 year, uint256 timestamp);
    event VerificationRejected(address indexed user, string reason);
    event VerificationRevoked(address indexed user);

    constructor(address verifierAddress) {
        require(verifierAddress != address(0), "Verifier is zero address");
        require(verifierAddress.code.length > 0, "Verifier is not a contract");
        verifier = IGroth16Verifier(verifierAddress);
        owner = msg.sender;
    }

    /// @notice Submit a Groth16 proof. Only the caller can verify themselves.
    /// @param pubSignals [isAboveLimit, currentYear, ageLimit]
    function verifyAge(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[3] calldata pubSignals
    ) external {
        require(pubSignals[0] == 1, "Proof does not claim age above limit");
        require(pubSignals[2] >= MIN_AGE, "Age limit below 18");

        uint256 chainYear = _currentYear();
        uint256 proofYear = pubSignals[1];
        require(
            proofYear <= chainYear + maxYearDrift && proofYear + maxYearDrift >= chainYear,
            "Proof year does not match chain year"
        );

        // Bind the replay guard to the sender so one wallet cannot reuse another's proof.
        bytes32 id = keccak256(abi.encode(msg.sender, pA, pB, pC, pubSignals));
        require(!usedProofs[id], "Proof already used");

        bool ok = verifier.verifyProof(pA, pB, pC, pubSignals);
        if (!ok) {
            revert("Invalid zero-knowledge proof");
        }

        usedProofs[id] = true;
        Record storage r = records[msg.sender];
        r.verified = true;
        r.verifiedAt = uint64(block.timestamp);
        r.proofYear = uint32(proofYear);
        r.count += 1;

        emit AgeVerified(msg.sender, proofYear, block.timestamp);
    }

    function isVerified(address user) external view returns (bool) {
        return records[user].verified;
    }

    function getRecord(address user)
        external
        view
        returns (bool verified, uint64 verifiedAt, uint32 proofYear, uint32 count)
    {
        Record memory r = records[user];
        return (r.verified, r.verifiedAt, r.proofYear, r.count);
    }

    /// @notice Users can remove their own record.
    function revoke() external {
        require(records[msg.sender].verified, "Not verified");
        records[msg.sender].verified = false;
        emit VerificationRevoked(msg.sender);
    }

    function setMaxYearDrift(uint256 drift) external {
        require(msg.sender == owner, "Only owner");
        require(drift <= 2, "Drift too large");
        maxYearDrift = drift;
    }

    /// @dev Calendar year from block.timestamp (Gregorian, UTC).
    function _currentYear() internal view returns (uint256) {
        int256 z = int256(block.timestamp / 86400) + 719468;
        int256 era = (z >= 0 ? z : z - 146096) / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 y = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        int256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        return uint256(y);
    }
}
