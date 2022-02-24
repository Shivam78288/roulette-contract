// SPDX-License-Identifier: MIT

pragma solidity ^0.8.5;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interfaces/IRandomGenerator.sol";

contract Roulette is 
    Initializable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Round {
        uint256 epoch;
        uint256 startTime;
        uint256 endTime;
        uint256 totalAmountBet;
        uint256 totalRewardAmount;
        uint256 treasuryCollections;
        bool oracleCalled;
        uint8 winningNumber;
        // the amount put on a number with a slab
        // totalAmountInSlabs[number][slab] = total amount bet on that number in a slab
        mapping(uint8 => mapping(uint8 => uint256)) totalAmountInSlabs;
    }

    /** 
    * @dev BetTypes
    * 0 for RedBlack, OddEven, HighLow => 18 numbers and reward = 1x the amount bet
    * 1 for Columns, Dozens => 12 numbers and reward = 2x the amount bet
    * 2 for Line => 6 numbers and reward = 5x the amount bet
    * 3 for Corner => 4 numbers and reward = 8x the amount bet
    * 4 for Street, ThreeNumBetsWithZero => 3 numbers and reward = 11x the amount bet
    * 5 for Split => 2 numbers and reward = 17x the amount bet
    * 6 for Number => 1 number and reward = 35x the amount bet
    */
    
    struct Bet{
        /**
        * @dev Differentiator 
        * for betType 0 => diff 0 for RedBlack, 1 for OddEven and 2 for HighLow
        * for betType 1 => diff 0 for columns and 1 for Dozens
        * for betType 2 => diff 0 for Line
        * for betType 3 => diff 0 for Corner
        * for betType 4 => diff 0 for Street and 1 for ThreeNumBetsWithZero
        * for betType 5 => diff 0 for Split
        * for betType 6 => diff 0 for Number
        */
        
        uint8 betType;
        uint8 differentiator;
        uint8[] numbers;
        uint256 amount;
    }

    struct BetInfo {
        Bet[] bets;
        //the amount put on a number with a slab
        // AmountInSlabs[number][slab] = total amount bet on that number in a slab
        mapping(uint8 => mapping(uint8 => uint256)) amountInSlabs;
        uint256 totalAmount;
        bool claimed;
    }

    //Payout, MinBetAmount, MaxBetAmount by BetType
    mapping(uint8 => uint8) public payout;
    mapping(uint8 => uint256) public minBetAmount;
    mapping(uint8 => uint256) public maxBetAmount;
    //For each kind of bet, the required number of numbers to be bet on
    mapping(uint8 => uint8) public numbersByKindOfBet;
    //Round by roundId
    mapping(uint256 => Round) public rounds;
    //BetInfo by roundId and user
    mapping(uint256 => mapping(address => BetInfo)) public ledger;
    //roundIds in which user participated 
    mapping(address => uint256[]) public userRounds;
    
    uint256 public currentEpoch;
    uint256 public closeInterval;
    uint256 public afterEndBuffer;
    uint256 public beforeEndBuffer;
    uint256 public startBuffer;
    address public admin;
    address public operator;
    uint256 public treasuryAmount;
    uint256 private randomRoundId;

    uint256 public randomNumUpdateAllowance; // seconds
    IRandomGenerator private randomGenerator;

    bool public genesisStartOnce;
    bool public genesisEndOnce;

    //Token which is used for betting
    address public tokenStaked;
    uint8 public tokenDecimals;

    event StartRound(uint256 indexed epoch, uint256 time);
    event EndRound(uint256 indexed epoch, uint256 time, uint8 winnningNum);
    event Bets(
        Bet[] bets,
        address indexed sender,
        uint256 indexed currentEpoch,
        uint256 totalAmount
    );
    event Claim(
        address indexed sender,
        uint256 indexed currentEpoch,
        uint256 amount
    );
    event ClaimTreasury(uint256 amount);
    event PayoutUpdated(
        uint256 indexed epoch,
        uint8[] indexed betType,
        uint8[] payout
    );
    event MinBetAmountUpdated(
        uint256 indexed epoch,
        uint8[] indexed betType, 
        uint256[] minBetAmount
        );
    event MaxBetAmountUpdated(
        uint256 indexed epoch,
        uint8[] indexed betType, 
        uint256[] maxBetAmount
        );
    event RewardsCalculated(
        uint256 indexed epoch,
        uint256 rewardAmount,
        uint256 treasuryAmount
    );
    event Pause(uint256 epoch);
    event Unpause(uint256 epoch);
    event OperatorChanged(address previousOperator, address newOperator);
    event CloseIntervalUpdated(
        uint256 currentEpoch, 
        uint256 closeInterval
        );
    event BuffersUpdated(
        uint256 currentEpoch, 
        uint256 startBuffer,
        uint256 beforeEndBuffer,
        uint256 afterEndBuffer
    );
    event OracleUpdateAllowanceUpdated(
        uint256 currentEpoch, 
        uint256 _randomNumUpdateAllowance
        );
    event TokenWithdrawal(address to, address token, uint256 amount);
    event NativeWithdrawal(address to, uint256 amount);
    event TokenStakedUpdated(uint256 epoch, address token, uint8 decimals);

    function initialize(
        bytes memory data,
        address[] memory _ownerAdminOperator
    ) public initializer {

        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        transferOwnership(_ownerAdminOperator[0]);
        admin = _ownerAdminOperator[1];
        operator = _ownerAdminOperator[2];

        genesisStartOnce = false;
        genesisEndOnce = false;

        numbersByKindOfBet[0] = 18;
        numbersByKindOfBet[1] = 12;
        numbersByKindOfBet[2] = 6;
        numbersByKindOfBet[3] = 4;
        numbersByKindOfBet[4] = 3;
        numbersByKindOfBet[5] = 2;
        numbersByKindOfBet[6] = 1;

        //Setting the bet payouts for different kinds of bets
        payout[0] = 1;
        payout[1] = 2;
        payout[2] = 5;
        payout[3] = 8;
        payout[4] = 11;
        payout[5] = 17;
        payout[6] = 35;        

        address _tokenStaked;
        uint8 _decimals;
        uint256 _closeInterval;
        // start buffer, before end buffer, after end buffer
        uint256[] memory _buffers;
        uint256 _randomNumUpdateAllowance;
        address _randomGenerator;
        
        (_tokenStaked, _decimals, _closeInterval,
        _buffers, _randomNumUpdateAllowance, _randomGenerator) 
            = abi.decode(
                    data, 
                    (address, uint8, uint256, uint256[], uint256, address)
                );

        tokenStaked = _tokenStaked;
        tokenDecimals = _decimals;
        randomGenerator = IRandomGenerator(_randomGenerator);
        closeInterval = _closeInterval;
        startBuffer = _buffers[0];
        beforeEndBuffer = _buffers[1];
        afterEndBuffer = _buffers[2];
        randomNumUpdateAllowance = _randomNumUpdateAllowance;

        //Setting min bet amounts and max bet amounts for each bet type
        //Min Bet is 1 token
        minBetAmount[0] = 10 ** _decimals;
        minBetAmount[1] = 10 ** _decimals;
        minBetAmount[2] = 10 ** _decimals;
        minBetAmount[3] = 10 ** _decimals;
        minBetAmount[4] = 10 ** _decimals;
        minBetAmount[5] = 10 ** _decimals;
        minBetAmount[6] = 10 ** _decimals;

        //Max bets for outside bets are 100 USDC
        //Max bets for inside bets are according to the payout!
        maxBetAmount[0] = 100 * 10 ** _decimals;
        maxBetAmount[1] = 80 * 10 ** _decimals;
        maxBetAmount[2] = 70 * 10 ** _decimals;
        maxBetAmount[3] = 60 * 10 ** _decimals;
        maxBetAmount[4] = 50 * 10 ** _decimals;
        maxBetAmount[5] = 40 * 10 ** _decimals;
        maxBetAmount[6] = 20 * 10 ** _decimals;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner(){}

    modifier onlyAdmin{
        require(msg.sender == admin, "admin: wut?");
        _;
    }

    modifier onlyOperator{
        require(msg.sender == operator, "operator: wut?");
        _;
    }

    modifier notContract{
        require(!_isContract(msg.sender), "contract not allowed");
        require(msg.sender == tx.origin, "proxy contract not allowed");
        _;
    }

    /**
     * @dev set admin address
     * callable by owner
     */
    function setAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Cannot be zero address");
        address previousAdmin = admin;
        admin = _admin;
        emit AdminChanged(previousAdmin, admin);
    }

    /**
     * @dev set operator address
     * callable by admin
     */
    function setOperator(address _operator) external onlyAdmin {
        require(_operator != address(0), "Cannot be zero address");
        address previousOperator = operator;
        operator = _operator;
        emit OperatorChanged(previousOperator, operator);
    }

    
    /**
     * @dev set token staked and its decimals
     * Callable by admin
     */
    function changeTokenStaked(address token, uint8 _decimals) 
        external 
        onlyAdmin 
    {
        tokenStaked = token;
        tokenDecimals = _decimals;

        emit TokenStakedUpdated(currentEpoch, token, _decimals);
    }
    
    /**
     * @dev set close interval in seconds
     * Callable by admin
     */
    function setCloseInterval(
        uint256 _closeInterval
        ) external
        onlyAdmin
        {

            require(
                afterEndBuffer <= _closeInterval && beforeEndBuffer <= _closeInterval,  
                "Roulette: buffers cannot be more than close interval"
                );

            closeInterval = _closeInterval;

            emit CloseIntervalUpdated(currentEpoch, _closeInterval);
        }

    /**
     * @dev set buffers in seconds
     * Callable by admin
     */
    function setBuffers(
        uint256[] memory _buffers
        ) external
        onlyAdmin
        {

            require(
                _buffers[1] <= closeInterval && _buffers[2] <= closeInterval,  
                "Roulette: before end and after end buffer cannot be more than close interval"
                );

            startBuffer = _buffers[0];
            beforeEndBuffer = _buffers[1];
            afterEndBuffer = _buffers[2];

            emit BuffersUpdated(currentEpoch, startBuffer, beforeEndBuffer, afterEndBuffer);
        }

    /**
     * @dev get all the payouts
     */
    function getPayouts() external view returns(uint8[] memory){
        uint8[] memory payouts = new uint8[](7);
        for(uint8 i = 0; i < 7; i++){
            payouts[i] = payout[i];
        }
        return payouts;
    }

    /**
     * @dev get random number address
     * callable by owner, admin and operator
     */
    function getRandomNumberOracleAdd() external view returns(address){
        require(
            msg.sender == owner() || msg.sender == admin || msg.sender == operator,
            "Roulette: unauthorized access" 
            );
        return address(randomGenerator);
    }


    /**
     * @dev set random number address
     * callable by admin
     */
    function setRandomNumberOracleAdd(address _randomGenerator) external onlyAdmin {
        require(_randomGenerator != address(0), "Cannot be zero address");
        randomGenerator = IRandomGenerator(_randomGenerator);
    }


    /**
     * @dev set random number update allowance
     * callable by admin
     */
    function setRandomNumUpdateAllowance(uint256 _randomNumUpdateAllowance)
        external
        onlyAdmin
    {
        randomNumUpdateAllowance = _randomNumUpdateAllowance;
        emit OracleUpdateAllowanceUpdated(currentEpoch, _randomNumUpdateAllowance);
    }

    /**
     * @dev set payout rate
     * callable by admin
     */
    function setPayout(uint8[] memory betType, uint8[] memory _payout) external onlyAdmin {
        require(
            betType.length == _payout.length && betType.length <= 7,
            "Roulette: Array lengths mismatch"
            );

        for(uint8 i = 0; i < betType.length; i++){
            require(
                betType[i] < 7,
                "Roulette: betTypes can range between 0 and 6(included) only"
                );
            payout[betType[i]] = _payout[i];
        }

        emit PayoutUpdated(currentEpoch, betType, _payout);
    }

    /**
     * @dev set minBetAmount
     * callable by admin
     */
    function setMinBetAmount(
        uint8[] memory betType, 
        uint256[] memory _minBetAmount
        ) external 
        onlyAdmin 
    {
        require(
            betType.length == _minBetAmount.length && betType.length <= 7,
            "Roulette: Array lengths mismatch"
            );
        
        for(uint8 i = 0; i < betType.length; i++){
            
            require(
                betType[i] < 7,
                "Roulette: betTypes can range between 0 and 6(included) only"
                );

            require(
                _minBetAmount[i] <= maxBetAmount[betType[i]],
                "Roulette: minBetAmount should be <= maxBetAmount"
                );

            minBetAmount[betType[i]] = _minBetAmount[i];
        }

        emit MinBetAmountUpdated(currentEpoch, betType, _minBetAmount);
    }

    /**
     * @dev set maxBetAmount
     * callable by admin
     */
    function setMaxBetAmount(
        uint8[] memory betType, 
        uint256[] memory _maxBetAmount
        ) external 
        onlyAdmin 
    {
        require(
            betType.length == _maxBetAmount.length && betType.length <= 7,
            "Roulette: Array lengths mismatch"
            );
        
        for(uint8 i = 0; i < betType.length; i++){

            require(
                betType[i] < 7,
                "Roulette: betTypes can range between 0 and 6(included) only"
                );

            require(
                minBetAmount[betType[i]] <= _maxBetAmount[i],
                "Roulette: maxBetAmount should be >= minBetAmount"
                );
            
            maxBetAmount[betType[i]] = _maxBetAmount[i];
        }

        emit MaxBetAmountUpdated(currentEpoch, betType, _maxBetAmount);
    }

    /**
     * @dev gets random round id
     * callable by admin
     */
    function getRandomRoundId() public view returns(uint256){
        require(
            msg.sender == owner() || msg.sender == admin || msg.sender == operator,
            "Roulette: Unauthorized function call"
        );
        return randomRoundId;
    }

    /**
     * @dev Start genesis round
     */
    function genesisStartRound() external virtual onlyOperator whenNotPaused {
        require(!genesisStartOnce, "Can only run once");
        currentEpoch = currentEpoch + 1;
        _startRound(currentEpoch);
        genesisStartOnce = true;
    }

    /**
     * @dev Lock genesis round
     */
    function genesisEndRound() external virtual onlyOperator whenNotPaused {
        require(
            genesisStartOnce,
            "Can only run after genesisStartRound is triggered"
        );
        require(!genesisEndOnce, "Can only run once");
        require(
            block.timestamp <= (rounds[currentEpoch].endTime).add(afterEndBuffer),
            "Can only end round within buffer"
        );
        uint8 random = _getNumberFromOracle();

        _safeEndRound(currentEpoch, random);
        _calculateRewards(currentEpoch);

        currentEpoch = currentEpoch + 1;
        _startRound(currentEpoch);
        genesisEndOnce = true;
    }

    /**
     * @dev Start the next round n, lock price for round n-1, end round n-2
     */
    function closeRound() external virtual onlyOperator whenNotPaused {
        require(
            genesisStartOnce && genesisEndOnce,
            "Can only run after genesis rounds"
        );
        uint8 randomNum = _getNumberFromOracle();
        // CurrentEpoch refers to previous round
        _safeEndRound(currentEpoch, randomNum);
        _calculateRewards(currentEpoch);

        // Increment currentEpoch to current round (n)
        currentEpoch = currentEpoch + 1;
    }


    /**
     * @dev Start round
     * Previous round n-2 must end
     */
    function startRound() external virtual onlyOperator whenNotPaused nonReentrant{
        require(
            genesisStartOnce,
            "genesisStartRound not triggered"
        );
        require(
            rounds[currentEpoch - 1].endTime != 0 && block.timestamp >= (rounds[currentEpoch - 1].endTime),
            "Roulette: Round n-1 not ended"
        );
        require(
            block.timestamp >= (rounds[currentEpoch - 1].endTime).add(startBuffer),
            "Roulette: Can only start round after start buffer"
        );
        _startRound(currentEpoch);
    }

    function _startRound(uint256 epoch) internal virtual{
        Round storage round = rounds[epoch];
        round.startTime = block.timestamp;
        round.endTime = block.timestamp.add(closeInterval);
        round.epoch = epoch;
        round.totalAmountBet = 0;

        emit StartRound(epoch, block.timestamp);
    }


    /**
     * @dev End round
     */
    function _safeEndRound(uint256 epoch, uint8 winningNum) internal virtual{
        require(
            rounds[epoch].startTime != 0,
            "round doesn't exist"
        );
        require(
            block.timestamp >= rounds[epoch].endTime &&
            block.timestamp <= rounds[epoch].endTime.add(afterEndBuffer),
            "Can only end between endTime & buffer"
        );

        _endRound(epoch, winningNum);
    }

    function _endRound(uint256 epoch, uint8 winningNum) internal virtual{
        Round storage round = rounds[epoch];
        round.winningNumber = winningNum;
        round.oracleCalled = true;

        emit EndRound(epoch, block.timestamp, winningNum);
    }

    /**
     * @dev Calculate rewards for round
     */
    function _calculateRewards(uint256 epoch) internal virtual{
        require(
            rounds[epoch].totalRewardAmount == 0,
            "Rewards calculated"
        );
        Round storage round = rounds[epoch];
        uint8 winner = round.winningNumber;
        uint256 totalRewards = 0;
        uint256 treasuryAmt = 0;

        for(uint8 i = 0; i < 7; i++){
            totalRewards = totalRewards.add(round.totalAmountInSlabs[winner][payout[i]].mul(payout[i] + 1));
        }

        round.totalRewardAmount = totalRewards;
        if(totalRewards < round.totalAmountBet){
            treasuryAmt = (round.totalAmountBet).sub(totalRewards);
        }
        // Add to treasury
        round.treasuryCollections = treasuryAmt;
        treasuryAmount = treasuryAmount.add(treasuryAmt);

        emit RewardsCalculated(
            epoch,
            totalRewards,
            treasuryAmt
        );
    }


    /**
     * @dev User bets
     */
    function bet(Bet[] memory bets) external virtual whenNotPaused notContract nonReentrant{

        require(bettable(currentEpoch), "Round not bettable");

        require(
            ledger[currentEpoch][msg.sender].totalAmount == 0,
            "Can only bet once per round"
        );

        BetInfo storage betInfo = ledger[currentEpoch][msg.sender];
        Round storage round = rounds[currentEpoch];

        for(uint8 i = 0; i< bets.length; i++){
            
            betInfo.bets.push(bets[i]);
            uint8 betType = bets[i].betType;
            uint8 differentiator = bets[i].differentiator;

            if(betType == 0){
                require(
                    differentiator == 0 || differentiator == 1 || differentiator == 2,
                    'Roulette: Invalid differentiator'
                    );
            }

            else if(betType == 1 || betType == 4){
                require(
                    differentiator == 0 || differentiator == 1,
                    'Roulette: Invalid differentiator'
                    );
            }

            else{
                require(
                    differentiator == 0,
                    'Roulette: Invalid differentiator'
                    );
            }

            require(betType < 7, "Roulette: betTypes can range between 0 and 6(included) only");

            require(
                bets[i].amount >= minBetAmount[betType] && bets[i].amount <= maxBetAmount[betType],
                "Roulette: Amount < MinBetAmount or Amount > MaxBetAmount for atleast one of the bets"
            );
            
            require(
                bets[i].numbers.length == numbersByKindOfBet[betType],
                "Roulette: invalid entry of numbers in atleast one bet"
                );

            uint8 slab = payout[betType];
            
            for(uint8 j = 0; j < bets[i].numbers.length; j++){
                round.totalAmountInSlabs[bets[i].numbers[j]][slab] = 
                    (round.totalAmountInSlabs[bets[i].numbers[j]][slab]).add(bets[i].amount);
                
                betInfo.amountInSlabs[bets[i].numbers[j]][slab] = 
                    (betInfo.amountInSlabs[bets[i].numbers[j]][slab]).add(bets[i].amount);
            }

            betInfo.totalAmount = (betInfo.totalAmount).add(bets[i].amount);
            round.totalAmountBet = 
                (round.totalAmountBet).add(bets[i].amount);
        }

        IERC20Upgradeable(tokenStaked).safeTransferFrom(msg.sender, address(this), betInfo.totalAmount);
        userRounds[msg.sender].push(currentEpoch);
        emit Bets(bets, msg.sender, currentEpoch, betInfo.totalAmount);
    }

   
    function claim(uint256 epoch) external virtual notContract nonReentrant{
        require(rounds[epoch].startTime != 0, "Round not started");
        require(block.timestamp > rounds[epoch].endTime, "Round not ended");
        require(!ledger[epoch][msg.sender].claimed, "Rewards claimed");

        (bool canClaim, uint256 reward) = claimable(epoch, msg.sender);
        
        require(
            canClaim || refundable(epoch, msg.sender),
            "Not claimable or refundable"
            );
        
        if(refundable(epoch, msg.sender)){
            reward = ledger[epoch][msg.sender].totalAmount;
        }

        ledger[epoch][msg.sender].claimed = true;
        _safeTransferToken(address(msg.sender), reward);

        emit Claim(msg.sender, epoch, reward);
    }

    /**
     * @dev Claim all rewards in treasury
     * callable by admin
     */
    function claimTreasury() external virtual onlyAdmin{
        require(treasuryAmount > 0, "Zero treasury amount");
        uint256 currentTreasuryAmount = treasuryAmount;
        treasuryAmount = 0;
        _safeTransferToken(admin, currentTreasuryAmount);
        emit ClaimTreasury(currentTreasuryAmount);
    }

    /**
     * @dev Return round epochs that a user has participated
     */
    function getUserRounds(
        address user,
        uint256 cursor,
        uint256 size
    ) external view returns (uint256[] memory, uint256) {
        uint256 length = size;
        if (length > userRounds[user].length - cursor) {
            length = userRounds[user].length - cursor;
        }

        uint256[] memory values = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            values[i] = userRounds[user][cursor + i];
        }

        return (values, cursor + length);
    }

    /**
     * @dev called by the admin to pause, triggers stopped state
     */
    function pause() public onlyAdmin whenNotPaused returns(bool){
        _pause();

        emit Pause(currentEpoch);
        return true;
    }

    /**
     * @dev called by the admin to unpause, returns to normal state
     * Reset genesis state. Once paused, the rounds would need to be kickstarted by genesis
     */
    function unpause() public onlyAdmin whenPaused returns(bool){
        genesisStartOnce = false;
        genesisEndOnce = false;
        _unpause();

        emit Unpause(currentEpoch);
        return true;
    }

    /**
     * @dev Get the claimable stats of specific epoch and user account
     */
    function claimable(uint256 epoch, address user) 
        public 
        virtual
        view 
        returns (bool, uint256) 
    {
        BetInfo storage betInfo = ledger[epoch][user];
        uint8 winningNum = rounds[epoch].winningNumber;
        uint256 winAmount = 0;
        for(uint8 i = 0; i < 7; i++){
            winAmount = winAmount.add((betInfo.amountInSlabs[winningNum][payout[i]]).mul(payout[i] + 1));
        }

        return
            ((rounds[epoch].oracleCalled && winAmount > 0), winAmount);
    }

    /**
     * @dev Get the refundable stats of specific epoch and user account
     */
    function refundable(uint256 epoch, address user)
        public
        virtual
        view
        returns (bool)
    {
        return
            //If the round is cancelled because of any error, then refund the amount
            (
                (!rounds[epoch].oracleCalled) &&
                (block.timestamp > (rounds[epoch].endTime).add(afterEndBuffer)) &&
                ledger[epoch][user].totalAmount != 0
            );
    }

    
    /**
     * @dev Get latest recorded price from oracle
     * If it falls below allowed buffer or has not updated, it would be invalid
     */
    function _getNumberFromOracle() internal returns (uint8) {
        uint256 allowedTime = block.timestamp.add(
            randomNumUpdateAllowance
        );
        (uint256 roundId, uint256 winner, uint256 timestamp) = 
            randomGenerator.latestRoundData(37);
        require(
            timestamp <= allowedTime,
            "Oracle update exceeded max allowance"
        );
        require(
            roundId >= randomRoundId,
            "Oracle update roundId < old id"
        );
        randomRoundId = roundId;
        return uint8(winner);
    }

    function _safeTransferToken(address to, uint256 value) internal {
        IERC20Upgradeable(tokenStaked).safeTransfer(to, value);
    }

    function _isContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }

    function bettable(uint256 epoch) public virtual view returns (bool) {
        Round storage round = rounds[epoch];
        return
            round.startTime != 0 &&
            round.endTime != 0 &&
            block.timestamp > round.startTime &&
            block.timestamp < round.endTime.sub(beforeEndBuffer);
    }

    //If someone accidently sends tokens or native currency to this contract
    function withdrawAllTokens(address token) external onlyAdmin{
        uint256 bal = IERC20Upgradeable(token).balanceOf(address(this));
        withdrawToken(token, bal);
    }

    
    function withdrawToken(address token, uint256 amount) public virtual onlyAdmin{
        // require(token != tokenStaked, "Cannot withdraw the token staked");
        uint256 bal = IERC20Upgradeable(token).balanceOf(address(this));
        require(bal >= amount, "balanace of token in contract too low");
        IERC20Upgradeable(token).safeTransfer(admin, amount);
        emit TokenWithdrawal(admin, token, amount);
    }

    function withdrawAllNative() external onlyAdmin{
        uint256 bal = address(this).balance;
        withdrawNative(bal);
    } 

    function withdrawNative(uint256 amount) public virtual onlyAdmin{
        uint256 bal = address(this).balance;
        require(bal >= amount, "balanace of native token in contract too low");
        (bool sent, ) = admin.call{value: amount}("");
        require(sent, "Failure in native token transfer");
        emit NativeWithdrawal(admin, amount);
    }
}

// contract RouletteV2 is Roulette{
//     function version() public pure returns(string memory){
//         return 'v2!';
//     }
// }
    