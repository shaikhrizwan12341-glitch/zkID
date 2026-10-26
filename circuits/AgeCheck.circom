pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// AgeCheck
// Proves: (currentYear - birthYear) >= ageLimit
// without revealing birthYear.
//
// Private input : birthYear
// Public inputs : currentYear, ageLimit
// Public output : isAboveLimit (1 if the statement holds, else 0)
//
// The circuit also forces birthYear to be a sane value
// (1900 <= birthYear <= currentYear) so a prover cannot pass
// with a nonsense field element.
//
// NOTE: This proves a statement about the input. It does NOT prove the
// input is true. A real KYC system needs a trusted issuer signature.
template AgeCheck() {
    signal input birthYear;      // private
    signal input currentYear;    // public
    signal input ageLimit;       // public
    signal output isAboveLimit;  // public

    // 1. birthYear fits in 12 bits (0..4095), blocks wrap-around values
    component birthBits = Num2Bits(12);
    birthBits.in <== birthYear;

    component yearBits = Num2Bits(12);
    yearBits.in <== currentYear;

    component limitBits = Num2Bits(8);
    limitBits.in <== ageLimit;

    // 2. birthYear >= 1900
    component minBirth = GreaterEqThan(12);
    minBirth.in[0] <== birthYear;
    minBirth.in[1] <== 1900;
    minBirth.out === 1;

    // 3. birthYear <= currentYear
    component notFuture = LessEqThan(12);
    notFuture.in[0] <== birthYear;
    notFuture.in[1] <== currentYear;
    notFuture.out === 1;

    // 4. (birthYear + ageLimit) <= currentYear  <=>  age >= ageLimit
    component ageCheck = LessEqThan(13);
    ageCheck.in[0] <== birthYear + ageLimit;
    ageCheck.in[1] <== currentYear;

    isAboveLimit <== ageCheck.out;
}

component main { public [currentYear, ageLimit] } = AgeCheck();
