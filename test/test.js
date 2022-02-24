//In this test, we are assuming 25 to be the random number that is fetched from the oracle

const {expectRevert} = require("@openzeppelin/test-helpers");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { deployProxy, upgradeProxy } = require("@openzeppelin/truffle-upgrades");
const Roulette = artifacts.require('Roulette.sol');
const RouletteV2 = artifacts.require('RouletteV2.sol');
const Token = artifacts.require('Token.sol');
const RandomMock = artifacts.require('RandomMock.sol');

const bets =  [
    ["5", "0", ['5','8'], "10000000000000000000"],
    ["2", "0", ['1','2','3','4','5','6'], "10000000000000000000"],
    ["6", "0", ['25'], "10000000000000000000"],
    ["1", "1", ['25','26','27','28','29','30','31','32','33','34','35','36'], "10000000000000000000"],
];

contract ('Roulette', (accounts) => {
    const [admin, operator, player] = [accounts[0], accounts[1], accounts[2]];
    let randomGenerator, roulette, token;

    beforeEach(async() => {
        token = await Token.new();
        randomGenerator = await RandomMock.new();

        const tokenAddress = token.address;
        const randomAddress = randomGenerator.address;

        const params = web3.eth.abi.encodeParameters(
            ["address", "uint8", "uint256", "uint256[]", "uint256", "address"],
            [
                tokenAddress, 
                18, 
                60, 
                [30,5,10], 
                15,
                randomAddress
            ],
          );
        
        const ownerAdminOperator = [admin, admin, operator];

        roulette = await deployProxy(
            Roulette, 
            [params, ownerAdminOperator], 
            {initializer: 'initialize', kind: 'uups'}
            );
        await Promise.all([
            token.faucet(roulette.address, web3.utils.toWei('1000000')),
            token.faucet(admin, web3.utils.toWei('1000000')),
            token.faucet(operator, web3.utils.toWei('1000000')),
            token.faucet(player, web3.utils.toWei('1000000')),
        ]);
    });

    it('deploys contract', async() => {
        const tokenBalance = await token.balanceOf(roulette.address);
        const slabs = await roulette.getPayouts();
        assert(tokenBalance.toString() === web3.utils.toWei('1000000'));
        assert(slabs.length === 7);

    });

    it('upgrades to new implementation', async() => {
        const rouletteV2 = await upgradeProxy(
            roulette.address, 
            RouletteV2
            );
        const version = await rouletteV2.version()
        assert(version === "v2!");
    });

    it('changes token staked when sent by admin', async() => {
        const tokenV2 = await Token.new();
        await roulette.changeTokenStaked(tokenV2.address, '18', {from: admin});
        const tokenStaked = await roulette.tokenStaked();
        assert(tokenStaked === tokenV2.address);
    });
    
    
    it('does not change token staked when sent by non-admin', async() => {
        const tokenV2 = await Token.new();
        await expectRevert(
            roulette.changeTokenStaked(tokenV2.address, '18', {from: operator}),
            "admin: wut?"
        );
    });

    it('sets closeInterval when sent by admin', async() => {
        await roulette.setCloseInterval('120', {from: admin});
        const closeInterval = await roulette.closeInterval();        
        assert(closeInterval.toString() === '120');
    });

    it('sets buffers when sent by admin', async() => {
        await roulette.setBuffers(['30','20','30'], {from: admin});
        const startBuffer = await roulette.startBuffer();
        const beforeEndBuffer = await roulette.beforeEndBuffer();
        const afterEndBuffer = await roulette.afterEndBuffer();
        assert(startBuffer.toString() === '30');
        assert(beforeEndBuffer.toString() === '20');
        assert(afterEndBuffer.toString() === '30');
    });

    it('does not set buffer when close interval > buffer', async() => {
        await expectRevert(
            roulette.setBuffers(['10','50','120'], {from: admin}),
            "Roulette: before end and after end buffer cannot be more than close interval"
        );
    });
    
    it('does not let non-admin set buffer and close interval', async() => {
        await expectRevert(
            roulette.setBuffers(['30','20','30'], {from: operator}),
            "admin: wut?"
        );
    });

    it('gets random oracle address only when admin/owner/operator calls', async() => {
        const addrAdmin = await roulette.getRandomNumberOracleAdd({from: admin});
        const addrOperator = await roulette.getRandomNumberOracleAdd({from: operator});
        assert(addrAdmin === randomGenerator.address);
        assert(addrOperator === randomGenerator.address);
        
        await expectRevert(
            roulette.getRandomNumberOracleAdd({from: player}),
            "Roulette: unauthorized access"
        );
    });

    it('set random oracle address only when sent by admin', async() => {
        await roulette.setRandomNumberOracleAdd(token.address, {from: admin});
        const addr = await roulette.getRandomNumberOracleAdd({from: admin});
        assert(addr === token.address);
        await expectRevert(
            roulette.setRandomNumberOracleAdd(token.address, {from: player}),
            "admin: wut?"
        );
    });

    it('sets payout only when sent by admin', async() => {
        const betTypes = ['1','2','3'];
        const payouts = ['2','4','6'];
        
        await roulette.setPayout(betTypes, payouts, {from: admin});
    
        const[
            payout1,  
            payout2,
            payout3,
        ] = await Promise.all([
            roulette.payout('1'),
            roulette.payout('2'),
            roulette.payout('3'),
        ]); 

        assert(payout1.toString() === '2');
        assert(payout2.toString() === '4');
        assert(payout3.toString() === '6');

        await expectRevert(
            roulette.setPayout(betTypes, payouts, {from: player}),
            "admin: wut?"
        );
    });

    it('does not set payout if length of betType != length of payouts', async() => {
        const betTypes = ['1','2','3'];
        const payouts = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, payouts, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set payout if length of arrays are > 7', async() => {
        const betTypes = ['0','1','2','3','4','5','6','7'];
        const payouts = ['2','4','2','4','2','4','2'];

        await expectRevert(
            roulette.setPayout(betTypes, payouts, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set payout if any of bet Type is >= 7', async() => {
        const betTypes = ['1','7'];
        const payouts = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, payouts, {from: admin}),
            "Roulette: betTypes can range between 0 and 6(included) only"
        );
    }); 

    it('sets minBetAmount only when called by admin', async() =>{
        const betTypes = ['1','2','3'];
        const minBets = ['1000000','1000000','1000000'];
        await roulette.setMinBetAmount(betTypes, minBets, {from: admin});

        const [
            minBet1,
            minBet2,
            minBet3,
        ] = await Promise.all([
            roulette.minBetAmount('1'),
            roulette.minBetAmount('2'),
            roulette.minBetAmount('3'),
        ]);

        assert(minBet1.toString() === '1000000');
        assert(minBet2.toString() === '1000000');
        assert(minBet3.toString() === '1000000');

        await expectRevert(
            roulette.setMinBetAmount(betTypes, minBets, {from: player}),
            "admin: wut?"
        );
    });

    it('does not set minBetAmount if length of betType != length of payouts', async() => {
        const betTypes = ['1','2','3'];
        const minBetAmount = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, minBetAmount, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set minBetAmount if length of arrays are > 7', async() => {
        const betTypes = ['0','1','2','3','4','5','6','7'];
        const minBetAmount = ['2','4','2','4','2','4','2'];

        await expectRevert(
            roulette.setMinBetAmount(betTypes, minBetAmount, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set minBetAmount if any of bet Type is >=11', async() => {
        const betTypes = ['1','7'];
        const minBetAmount = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, minBetAmount, {from: admin}),
            "Roulette: betTypes can range between 0 and 6(included) only"
        );
    });

    it('does not set minBetAmount if minBetAmount > maxBetAmount for that bet', async() => {
        const betTypes = ['0'];
        const maxBet = ['1000000000000000000000'];
        const minBet = ['1001000000000000000000'];

        await roulette.setMaxBetAmount(betTypes, maxBet, {from: admin});
        await expectRevert(
            roulette.setMinBetAmount(betTypes, minBet, {from: admin}),
            "Roulette: minBetAmount should be <= maxBetAmount"
        );
    });

    it('sets maxBetAmount only when called by admin', async() =>{
        const betTypes = ['1','2','3'];
        const maxBets = ['100000000000000000000','100000000000000000000','100000000000000000000'];
        await roulette.setMaxBetAmount(betTypes, maxBets, {from: admin});

        const [
            maxBet1,
            maxBet2,
            maxBet3,
        ] = await Promise.all([
            roulette.maxBetAmount('1'),
            roulette.maxBetAmount('2'),
            roulette.maxBetAmount('3'),
        ]);

        assert(maxBet1.toString() === '100000000000000000000');
        assert(maxBet2.toString() === '100000000000000000000');
        assert(maxBet3.toString() === '100000000000000000000');

        await expectRevert(
            roulette.setMaxBetAmount(betTypes, maxBets, {from: player}),
            "admin: wut?"
        );
    });

    it('does not set maxBetAmount if length of betType != length of payouts', async() => {
        const betTypes = ['1','2','3'];
        const maxBetAmount = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, maxBetAmount, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set minBetAmount if length of arrays are > 7', async() => {
        const betTypes = ['0','1','2','3','4','5','6','7'];
        const maxBetAmount = ['2','4','2','4','2','4','2','4'];

        await expectRevert(
            roulette.setMaxBetAmount(betTypes, maxBetAmount, {from: admin}),
            "Roulette: Array lengths mismatch"
        );
    });

    it('does not set maxBetAmount if any of bet Type is >= 7', async() => {
        const betTypes = ['1','7'];
        const maxBetAmount = ['2','4'];

        await expectRevert(
            roulette.setPayout(betTypes, maxBetAmount, {from: admin}),
            "Roulette: betTypes can range between 0 and 6(included) only"
        );
    });

    it('does not set maxBetAmount if minBetAmount > maxBetAmount for that bet', async() => {
        const betTypes = ['0'];
        const maxBet = ['1000000000000000000'];
        const minBet = ['1001000000000000000'];

        await roulette.setMinBetAmount(betTypes, minBet, {from: admin});
        await expectRevert(
            roulette.setMaxBetAmount(betTypes, maxBet, {from: admin}),
            "Roulette: maxBetAmount should be >= minBetAmount"
        );
    });

    it('get random round id only if admin/owner/operator calls', async() => {
        const roundIdAdmin = await roulette.getRandomRoundId({from: admin});
        const roundIdOperator = await roulette.getRandomRoundId({from: operator})
        assert(roundIdAdmin.toString() === roundIdOperator.toString());

        await expectRevert(
            roulette.getRandomRoundId({from: player}),
            "Roulette: Unauthorized function call"
        );  
    });

    it('Genesis start once if operator sends', async() => {
        await roulette.genesisStartRound({from: operator});
        const genesisStart = await roulette.genesisStartOnce();
        assert(genesisStart === true);
    });

    it('Genesis start does not run if sent by non-operator', async() => {
        await expectRevert(
            roulette.genesisStartRound({from: player}),
            "operator: wut?"
        );
    });

    it('Genesis start does not run if paused', async() => {
        await roulette.pause({from: admin});
        await expectRevert(
            roulette.genesisStartRound({from: operator}),
            "Pausable: paused"
        );
    });

    it('Genesis end once if operator sends', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        await new Promise((resolve, _) => setTimeout(resolve, 60000)); 
        console.log('Genesis End Starting');
        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');
        const genesisEnd = await roulette.genesisEndOnce();
        assert(genesisEnd === true);
    });

    it('Closes round if operator sends', async() => {
        await token.approve(roulette.address, '40000000000000000000', {from: player});
        
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        
        await new Promise((resolve, _) => setTimeout(resolve, 60000)); 

        await roulette.setCloseInterval('150',{from: admin})
        console.log('Genesis End Starting');

        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        let round = await roulette.rounds('2');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(bets, {from: player});

        const timeLeft = (round.endTime - Math.floor(new Date().getTime() / 1000)) * 1000;
        console.log(`Time Left: ${timeLeft/1000}`);

        await new Promise((resolve, _) => setTimeout(resolve, timeLeft));
        
        await roulette.closeRound({from: operator});
        console.log(`Round closed`);
        
        round = await roulette.rounds(`2`);
        const rewards = round.totalRewardAmount;
        assert(rewards > 0);
    });

    it('cannot close round if time < endTime', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await expectRevert(
            roulette.genesisEndRound({from: operator}),
            "Can only end between endTime & buffer"
        ); 
    });

    it('cannot close round if time > endTime + buffer', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.genesisEndRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 70000));
        await expectRevert(
            roulette.closeRound({from: operator}),
            "Can only end between endTime & buffer"
        ); 
    });

    it('cannot close round if genesis rounds not executed', async() => {
        await expectRevert(
            roulette.closeRound({from: operator}),
            "Can only run after genesis rounds"
        );
    });

    it('execute start round if sent by operator', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.genesisEndRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.closeRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 30000));

        await roulette.startRound({from: operator});
        const round = await roulette.currentEpoch();
        assert(round.toString() === '3')
    });

    it('cannot execute start round if sent by non-operator', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.genesisEndRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.closeRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 30000));

        await expectRevert(
            roulette.startRound({from: player}),
            'operator: wut?'
        ); 
    });

    it('cannot execute start round before genesis start', async() => {
        await expectRevert(
            roulette.startRound({from: operator}),
            'genesisStartRound not triggered'
        );
    });

    it('cannot execute start round if sent before start buffer', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.genesisEndRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 60000));

        await roulette.closeRound({from: operator});

        await expectRevert(
            roulette.startRound({from: operator}),
            'Roulette: Can only start round after start buffer'
        ); 
    });

    it('cannot execute start round if previous round not ended', async() => {
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await expectRevert(
            roulette.startRound({from: operator}),
            'Roulette: Round n-1 not ended'
        );
    });


    it('bets are executed when round is bettable', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        const round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(bets, {from: player});
        console.log(`Player bets`);
        console.log(`Current timestamp: ${Math.floor(new Date().getTime() / 1000)}`);

        const epoch = await roulette.currentEpoch();
        const playerBets = await roulette.ledger(epoch.toString(), player);
        assert(playerBets.claimed === false);
        assert(playerBets.totalAmount.toString() === '40000000000000000000');
    });

    it('bets not executed if round is not bettable', async() => {
        await roulette.genesisStartRound({from: operator});
        await new Promise((resolve, _) => setTimeout(resolve, 55000)); 
        await expectRevert(
            roulette.bet(bets, {from: player}),
            "Round not bettable"
        );
    });

    it('Cannot bet twice', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        const round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);
        
        await roulette.bet(bets, {from: player});

        await expectRevert(
            roulette.bet(bets, {from: player}),
            'Can only bet once per round'
        );
    });

    it('Cannot bet if any bet type is >= 7', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});
        const betPlayer = [["7", ['5','8'], "10000000000000000000"]]
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        
        await expectRevert(
            roulette.bet(betPlayer, {from: player}),
            'Roulette: betTypes can range between 0 and 6(included) only'
        );
    });

    it('Cannot bet if bet amt < minBetAmt', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});
        const betPlayer = [["5", ['5','8'], "10000000"]]

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        
        await expectRevert(
            roulette.bet(betPlayer, {from: player}),
            'Roulette: Amount < MinBetAmount or Amount > MaxBetAmount for atleast one of the bets'
        );
    });

    it('Cannot bet if bet amt > maxBetAmt', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        const betPlayer = [["5", ['5','8'], "1000000000000000000000000000"]]

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        
        await expectRevert(
            roulette.bet(betPlayer, {from: player}),
            'Roulette: Amount < MinBetAmount or Amount > MaxBetAmount for atleast one of the bets'
        );
    });

    it('Cannot bet if total number of numbers in a bet is different than allowed', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});
        //For betType 6, 2 nums are allowed
        const betPlayer = [["5", ['5','8','9'], "10000000000000000000"]]
        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        
        await expectRevert(
            roulette.bet(betPlayer, {from: player}),
            'Roulette: invalid entry of numbers in atleast one bet'
        );
    });

    it('Calculates rewards correctly', async() => { 
        await roulette.setCloseInterval('160',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');
        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(bets, {from: player});
        console.log(`Player bets`);

        const currentTime = Math.floor(new Date().getTime() / 1000);
        const timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, timeLeft*1000)); 
        
        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        round = await roulette.rounds('1');
        const rewards = round.totalRewardAmount;

        console.log(`Rewards: ${rewards.toString()}`)
        assert(rewards.toString() === '390000000000000000000');
    });

    it('Calculates treasury amt correctly', async() => { 
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        const currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);
        
        const timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, timeLeft*1000)); 

        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        round = await roulette.rounds('1');
        const rewards = round.totalRewardAmount;
        const treasuryCollection = round.treasuryCollections;
        const totalTreasury = await roulette.treasuryAmount();

        console.log(`Rewards: ${rewards.toString()}`);
        console.log(`treasuryCollection: ${treasuryCollection.toString()}`);
        console.log(`totalTreasury: ${totalTreasury.toString()}`);
        assert(rewards.toString() === '30000000000000000000');
        assert(treasuryCollection.toString() === '10000000000000000000');
        assert(totalTreasury.toString() === '10000000000000000000')
    });

    it('does not allow bets with invalid differentiator', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        const betsPlayer =  [["5", "1", ['5','8'], "10000000000000000000"]];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        await expectRevert(
            roulette.bet(betsPlayer, {from: player}),
            'Roulette: Invalid differentiator'
        );  
    });

    it('Claimable works fine', async() => {
        await roulette.setCloseInterval('300',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});
        await token.approve(roulette.address, '40000000000000000000', {from: operator});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        const betsOperator =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','7','8','9','10','11','12'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        await roulette.bet(betsOperator, {from: operator});
        console.log(`Operator bets`);

        const currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);
        
        const timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, timeLeft*1000)); 

        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        const claimablePlayer = await roulette.claimable('1', player);
        const claimableOperator = await roulette.claimable('1', operator);
        assert(claimablePlayer[0] === true);
        assert(claimableOperator[0] === false);
        assert(claimablePlayer[1].toString() === '30000000000000000000');
        assert(claimableOperator[1].toString() === 0);
    });

    it('refundable works fine', async() => {
        await roulette.setCloseInterval('200',{from: admin})
        await token.approve(roulette.address, '80000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        let currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);
        
        let timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, (timeLeft)*1000));
        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        const round2 = await roulette.rounds('2');

        let refundablePlayer = await roulette.refundable('1', player);
        assert(refundablePlayer === false);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets again`);

        currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);
        
        timeLeft = round2.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)

        await new Promise((resolve, _) => setTimeout(resolve, (timeLeft+20)*1000));
        refundablePlayer = await roulette.refundable('2', player);
        assert(refundablePlayer === true);
    });

    it('Can claim if claimable & cannot claim twice', async() => {
        await roulette.setCloseInterval('200',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        let currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);
        
        let timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, (timeLeft)*1000));
        await roulette.genesisEndRound({from: operator});
        console.log('Genesis End');

        const tokensBefore = await token.balanceOf(player);
        await roulette.claim('1', {from: player});
        const tokensAfter = await token.balanceOf(player);
        const tokensClaimed = tokensAfter.sub(tokensBefore)
        console.log(`tokens claimed ${tokensClaimed.toString()}`)
        assert(tokensClaimed.toString() === '30000000000000000000')

        await expectRevert(
            roulette.claim('1', {from: player}),
            'Rewards claimed'
        );
    });

    it('Can claim if refundable', async() => {
        await roulette.setCloseInterval('140',{from: admin})
        await token.approve(roulette.address, '80000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        let currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);

        let timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)

        await new Promise((resolve, _) => setTimeout(resolve, (timeLeft + 10)*1000));

        let refundablePlayer = await roulette.refundable('1', player);
        console.log(refundablePlayer);
        // assert(refundablePlayer === true);
        const tokensBefore = await token.balanceOf(player);
        await roulette.claim('1', {from: player});
        const tokensAfter = await token.balanceOf(player);
        const tokensClaimed = tokensAfter.sub(tokensBefore);
        console.log(`tokens claimed ${tokensClaimed.toString()}`);
        assert(tokensClaimed.toString() === '40000000000000000000');
    });

    it('Cannot claim if not claimable or refundable', async() => {
        await roulette.setCloseInterval('150',{from: admin})
        await token.approve(roulette.address, '80000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','26','27','28','29','30','31'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        let currentTime = Math.floor(new Date().getTime() / 1000);
        console.log(`Current timestamp: ${currentTime}`);

        let timeLeft = round.endTime - currentTime;
        console.log(`timeLeft: ${timeLeft}`)
        
        await new Promise((resolve, _) => setTimeout(resolve, (timeLeft)*1000));

        await roulette.genesisEndRound({from: operator});
        console.log('Genesis end round')

        await expectRevert(
            roulette.claim('1', {from: player}),
            'Not claimable or refundable'
        ); 
        await expectRevert(
            roulette.claim('1', {from: operator}),
            'Not claimable or refundable'
        ); 
    });

    it('Cannot claim if round does not exist', async() => {
        await expectRevert(
            roulette.claim('1', {from: player}),
            'Round not started'
        );
    });

    it('Cannot claim if round not ended', async() => {
        await roulette.setCloseInterval('200',{from: admin})
        await token.approve(roulette.address, '40000000000000000000', {from: player});

        const betsPlayer =  [
            ["5", "0", ['5','8'], "10000000000000000000"],
            ["1", "0", ['1','2','3','4','5','6','25','26','27','28','29','30'], "10000000000000000000"],
            ["6", "0", ['5'], "10000000000000000000"],
            ["2", "0", ['5','6','7','8','9','10'], "10000000000000000000"]
        ];

        await roulette.genesisStartRound({from: operator});
        console.log('Genesis Start');

        let round = await roulette.rounds('1');
        console.log(`start time : ${round.startTime}`);
        console.log(`end time : ${round.endTime}`);

        await roulette.bet(betsPlayer, {from: player});
        console.log(`Player bets`);

        await expectRevert(
            roulette.claim('1', {from: player}),
            'Round not ended'
        );  
    });
});