import {
  anvilProductionItems,
  bubblesMap,
  cardEquipMap,
  cardLevelMap,
  cardSetMap,
  classMap,
  filteredLootyItems,
  guildBonusesMap,
  keysMap,
  mapsMap,
  maxCarryCap,
  monstersMap,
  obolCharacterShapeMap,
  obolFamilyShapeMap,
  obolMap,
  prayersMap,
  shopMapping,
  shrineMap,
  skillIndexMap,
  starSignMap,
  statuesMap,
  talentPagesMap,
  worldNpcMap
} from './src/commons/maps.js';

import {
  bribesMap,
  cauldronMapping,
  itemMap,
  questsMap,
  shopStockMapping,
  stampsMap,
  talentsMap,
  vialMapping
} from './src/commons/processed-maps.js';

try {
  chrome.storage.local.clear();
  let activeTabId;

  chrome.tabs.onActivated.addListener(function (activeInfo) {
    activeTabId = activeInfo.tabId;
  });

  chrome.webNavigation.onBeforeNavigate.addListener(() => {
    chrome.runtime.sendMessage({ data: false })
  });

  chrome.tabs.onUpdated.addListener(() => {
    chrome.runtime.sendMessage({ data: false })
  })

  chrome.storage.onChanged.addListener(function (changes) {
    for (let [key, { newValue }] of Object.entries(changes)) {
      // Run when all of the data is set.
      if (newValue && Object.keys(newValue).length === 3) {
        console.log(`key ${key}`, newValue);
        const characterData = parseData(newValue);
        (async () => {
          await sendToWebpage(characterData);
        })();
        chrome.runtime.sendMessage({ data: newValue });
      }
    }
  });

  const sendToWebpage = async (characterData) => {
    console.log('Save to web page');
    let queryOptions = { active: true, lastFocusedWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);
    if (!tab) {
      tab = await chrome.tabs.get(activeTabId);
    }
    const manifest = chrome.runtime.getManifest();
    chrome.scripting.executeScript({
      target: { tabId: tab?.id },
      func: (characterData, manifest) => localStorage.setItem('characterData', JSON.stringify({
        ...characterData,
        version: manifest.version
      })),
      args: [characterData, manifest]
    }, () => { console.log('Done!') });
  }

  let isRunning = false;

  const parseData = (data) => {
    console.log('Started Parsing');
    if (isRunning || !data) {
      return;
    }
    isRunning = true;

    const final = {
      account: {},
      characters: [],
    };

    const fields = data?.save?.documentChange?.document?.fields;
    const characterNames = data?.charNames;
    const guildInfo = data?.guildInfo;

    const account = buildAccountData(fields);

    // Initialize characters' array
    const characters = Object.keys(characterNames).map((index) => ({
      name: characterNames[index],
    }));
    let charactersData = buildCharacterData(characters, fields, account);
    console.log('Finished building character data');

    const quests = mapAccountQuests(charactersData);
    charactersData = charactersData.map(({ quests, ...rest }) => rest);

    final.characters = charactersData;
    final.account = { ...account, quests };
    final.guild = buildGuildData(guildInfo, fields);

    chrome.runtime.sendMessage({ data: true });

    isRunning = false;

    console.log('Finished Parsing');
    return final;
  };

  const mapAccountQuests = (characters) => {
    const quests = Object.keys(questsMap);
    let mappedQuests = quests?.reduce((res, npcName) => {
      const npcQuests = questsMap[npcName];
      const worldName = worldNpcMap?.[npcName]?.world;
      const npcIndex = worldNpcMap?.[npcName]?.index;
      if (!worldName) return res;
      for (let i = 0; i < characters?.length; i++) {
        const rawQuest = cloneObject(characters?.[i]?.quests?.[npcName]) || {};
        const questIndices = Object.keys(rawQuest);
        let skip = false;
        for (let j = 0; j < questIndices?.length; j++) {
          const questIndex = questIndices[j];
          const questStatus = rawQuest[questIndex];
          if (!npcQuests[questIndex]) continue;
          if (npcQuests?.[questIndex - 1] && (!skip && (questStatus === 0 || questStatus === -1) || questStatus === 1)) {
            npcQuests[questIndex - 1].progress = npcQuests[questIndex - 1]?.progress?.filter(({ charIndex }) => charIndex !== i);
          }
          if (questStatus === 1) { // completed
            npcQuests[questIndex].completed = [...(npcQuests[questIndex]?.completed || []), {
              charIndex: i,
              status: questStatus
            }];
            npcQuests[questIndex].progress = [...(npcQuests[questIndex]?.progress || []), {
              charIndex: i,
              status: questStatus
            }];
          } else if (!skip && (questStatus === 0 || questStatus === -1)) {
            npcQuests[questIndex].progress = [...(npcQuests[questIndex]?.progress || []), {
              charIndex: i,
              status: questStatus
            }]
            skip = true;
          }
        }
      }
      return {
        ...res,
        [worldName]: [
          ...(res?.[worldName] || []),
          {
            name: npcName,
            index: npcIndex,
            npcQuests: Object.values(npcQuests)
          }
        ]
      };
    }, {});
    for (const mappedQuest in mappedQuests) {
      let val = mappedQuests[mappedQuest];
      val?.sort((a, b) => a?.index - b?.index);
    }
    return mappedQuests;
  };

  const buildAccountData = (fields) => {
    console.log('Started building account data');
    const accountData = {};
    const cardsObject = JSON.parse(fields?.["Cards0"].stringValue);

    accountData.cards = Object.keys(cardsObject).reduce(
      (res, card) => ({
        ...res,
        [cardEquipMap?.[card]]: {
          amount: cardsObject?.[card],
          stars: calculateStars(card, cardsObject?.[card]),
        },
      }), {});

    const obolsObject = fields.ObolEqO1.arrayValue.values;
    accountData.obols = obolsObject.map(({ stringValue }, index) => ({
      name: obolMap[stringValue],
      shape: obolFamilyShapeMap[index],
      rawName: stringValue,
      ...(obolFamilyShapeMap[index] ? obolFamilyShapeMap[index] : {})
    }));

    const lootyObject = JSON.parse(fields.Cards1.stringValue);
    const allItems = JSON.parse(JSON.stringify(itemMap)); // Deep clone
    lootyObject.forEach((lootyItemName) => {
      if (allItems?.[lootyItemName]?.displayName) {
        delete allItems?.[lootyItemName];
      }
    });

    accountData.missingLootyItems = Object.keys(allItems).reduce((res, key) => (!filteredLootyItems[key] ? [
      ...res,
      {
        name: allItems?.[key]?.displayName,
        rawName: key,
      }] : res), []);

    const stampsMapping = { 0: "combat", 1: "skills", 2: "misc" };
    const stamps = fields['StampLv']?.arrayValue.values?.reduce((result, item, index) => ({
      ...result,
      [stampsMapping?.[index]]: Object.keys(item.mapValue.fields).reduce((res, key) => (key !== 'length' ? [
          ...res,
          { level: parseFloat(item.mapValue.fields[key].integerValue) }
        ]
        : res), []),
    }), {});

    accountData.stamps = {
      combat: stamps.combat.map((item, index) => ({ ...stampsMap['combat'][index], ...item })),
      skills: stamps.skills.map((item, index) => ({ ...stampsMap['skills'][index], ...item })),
      misc: stamps.misc.map((item, index) => ({ ...stampsMap['misc'][index], ...item })),
    };

    const goldStatuesObject = JSON.parse(fields['StuG'].stringValue);
    const goldStatues = goldStatuesObject.reduce((res, item, index) => (item === 1 ? {
      ...res,
      [index]: true
    } : res), {});
    const firstCharacterStatues = JSON.parse(fields['StatueLevels_0'].stringValue);
    accountData.statues = Object.keys(goldStatues).map((statueIndex) => ({
      ...({ ...statuesMap?.[statueIndex], rawName: `StatueG${parseInt(statueIndex) + 1}` } || {}),
      level: firstCharacterStatues[statueIndex][0]
    }));

    const moneyArr = ['MoneyBANK', 'Money_0', 'Money_1', 'Money_2', 'Money_3', 'Money_4', 'Money_5', 'Money_6', 'Money_7', 'Money_8'];
    const money = moneyArr.reduce((res, moneyInd) =>
      (res + (fields[moneyInd] ? parseInt(fields[moneyInd].integerValue) : 0)), 0);

    accountData.money = String(money).split(/(?=(?:..)*$)/);

    const inventoryArr = fields['ChestOrder'].arrayValue.values;
    const inventoryQuantityArr = fields['ChestQuantity'].arrayValue.values;
    accountData.inventory = getInventory(inventoryArr, inventoryQuantityArr, 'storage');

    const shrinesArray = JSON.parse(fields['Shrine']?.stringValue);
    const startingIndex = 18;
    accountData.shrines = shrinesArray.reduce((res, item, localIndex) => {
      const index = startingIndex + localIndex;
      const shrineName = shrineMap[index];
      return item?.[0] !== 0 && shrineName !== 'Unknown' ? [...res, {
        shrineLevel: item?.[3],
        name: shrineName,
        rawName: `ConTowerB${index}`
      }] : res;
    }, [])

    const colosseumIndexMapping = { 1: true, 2: true, 3: true };
    const colosseumHighscoresArray = fields['FamValColosseumHighscores']?.arrayValue?.values;
    accountData.colosseumHighscores = colosseumHighscoresArray
      .filter((_, index) => colosseumIndexMapping[index])
      .map(({ doubleValue, integerValue }) => Math.floor(doubleValue) || Math.floor(integerValue));

    const minigameIndexMapping = { 0: 'chopping', 1: 'fishing', 2: 'catching', 3: 'mining' };
    const minigameHighscoresArray = fields['FamValMinigameHiscores']?.arrayValue?.values;
    accountData.minigameHighscores = minigameHighscoresArray
      .filter((_, index) => minigameIndexMapping[index])
      .map(({ integerValue }, index) => ({ minigame: minigameIndexMapping[index], score: integerValue }));

    accountData.worldTeleports = fields?.['CYWorldTeleports']?.integerValue;
    accountData.keys = fields?.['CYKeysAll']?.arrayValue.values.reduce((res, { integerValue }, index) => integerValue > 0 ? [...res, { amount: integerValue, ...keysMap[index] }] : res, []);
    accountData.colosseumTickets = fields?.['CYColosseumTickets'].integerValue;
    accountData.obolFragments = fields?.['CYObolFragments'].integerValue;
    accountData.silverPens = fields?.['CYSilverPens'].integerValue;
    accountData.goldPens = fields?.['CYGoldPens'].integerValue;
    accountData.gems = fields?.['GemsOwned'].integerValue;

    const shopStockArray = fields['ShopStock']?.arrayValue?.values;
    accountData.shopStock = shopStockArray?.reduce((res, shopObject, shopIndex) => {
      const realShopStock = shopObject?.mapValue?.fields;
      delete realShopStock.length;
      const shopName = shopMapping?.[shopIndex]?.name;
      const mapped = Object.values(realShopStock)?.reduce((res, item, itemIndex) => {
        const isIncluded = shopMapping?.[shopIndex]?.included?.[itemIndex];
        const amount = parseInt(item?.integerValue) || 0;
        return amount > 0 && isIncluded ? [...res, { amount: item?.integerValue, ...shopStockMapping[shopName][itemIndex] }] : res;
      }, [])
      return [...res, mapped]
    }, []);

    // 0-3 cauldrons
    // 4 - vials
    accountData.alchemy = {};
    const cauldronsIndexMapping = { 0: "power", 1: "quicc", 2: "high-iq", 3: 'kazam' };
    const cauldronsTextMapping = { 0: "O", 1: "G", 2: "P", 3: 'Y' };
    const cauldronsInfoArray = fields?.CauldronInfo?.arrayValue?.values;
    accountData.alchemy.bubbles = cauldronsInfoArray?.reduce((res, { mapValue }, index) => (index <= 3 ? {
      ...res,
      [cauldronsIndexMapping?.[index]]: Object.keys(mapValue?.fields)?.reduce((res, key, bubbleIndex) => (
        key !== 'length' ? [
          ...res,
          {
            level: parseInt(mapValue?.fields?.[key]?.integerValue) || 0,
            rawName: `aUpgrades${cauldronsTextMapping[index]}${bubbleIndex}`,
            ...cauldronMapping[cauldronsIndexMapping?.[index]][key],
          }] : res), [])
    } : res), {});

    const vialsObject = fields?.CauldronInfo?.arrayValue?.values?.[4]?.mapValue?.fields;
    accountData.alchemy.vials = Object.keys(vialsObject).reduce((res, key, index) => {
      const vial = vialMapping?.[index];
      return key !== 'length' ? [...res, {
        level: parseInt(vialsObject?.[key]?.integerValue) || 0,
        ...vial
      }] : res;
    }, []);

    // first 16 elements belong to cauldrons' levels
    // 4 * 4
    const rawCauldronsLevelsArray = fields?.['CauldUpgLVs']?.arrayValue.values;
    const cauldronsLevels = rawCauldronsLevelsArray.slice(0, 16);
    const cauldronsLevelsMapping = { 0: "power", 4: "quicc", 8: "high-iq", 12: 'kazam' };
    let cauldrons = {};
    const chunk = 4;
    for (let i = 0, j = cauldronsLevels.length; i < j; i += chunk) {
      const [speed, luck, cost, extra] = cauldronsLevels.slice(i, i + chunk);
      cauldrons[cauldronsLevelsMapping[i]] = {
        speed: parseInt(speed?.integerValue) || 0,
        luck: parseInt(luck?.integerValue) || 0,
        cost: parseInt(cost?.integerValue) || 0,
        extra: parseInt(extra?.integerValue) || 0
      };
    }
    accountData.alchemy.cauldrons = cauldrons;

    const bribesArray = fields?.['BribeStatus']?.arrayValue?.values;
    accountData.bribes = bribesArray?.reduce((res, { integerValue }, index) => {
      return integerValue !== '-1' ? [...res, {
        done: integerValue === '1',
        ...(bribesMap?.[index] || [])
      }] : res;
    }, []);

    console.log('Finished building account data');
    return accountData;
  };

  const buildCharacterData = (characters, fields, account) => {
    console.log('Started building character data');
    return characters.map((character, index) => {
      const extendedChar = {};
      const classObject = fields?.[`CharacterClass_${index}`];
      extendedChar.class =
        classMap[parseInt(classObject?.doubleValue || classObject?.integerValue)];
      extendedChar.afkTarget = monstersMap?.[fields?.[`AFKtarget_${index}`]?.stringValue];

      // stats
      const statsArray = fields[`PVStatList_${index}`]?.arrayValue?.values;
      extendedChar.level = parseInt(statsArray[4]?.integerValue);
      extendedChar.stats = {
        strength: parseInt(statsArray[0]?.integerValue),
        agility: parseInt(statsArray[1]?.integerValue),
        wisdom: parseInt(statsArray[2]?.integerValue),
        luck: parseInt(statsArray[3]?.integerValue),
      };

      extendedChar.currentMap =
        mapsMap?.[parseInt(fields?.[`CurrentMap_${index}`]?.integerValue)];

      // inventory bags used
      const rawInvBagsUsed = JSON.parse(
        fields?.[`InvBagsUsed_${index}`]?.stringValue
      );
      const bags = Object.keys(rawInvBagsUsed);
      extendedChar.invBagsUsed = bags?.map((bag) => ({
        id: bag,
        name: itemMap[`InvBag${parseInt(bag) < 100 ? parseInt(bag) + 1 : bag}`]?.displayName,
        rawName: `InvBag${parseInt(bag) < 100 ? parseInt(bag) + 1 : bag}`
      })).filter(bag => bag.name);
      const carryCapacityObject = JSON.parse(fields[`MaxCarryCap_${index}`].stringValue);
      extendedChar.carryCapBags = Object.keys(carryCapacityObject).map((bagName) => (maxCarryCap?.[bagName]?.[carryCapacityObject[bagName]])).filter(bag => bag)

      // equipment indices (0 = armor, 1 = tools, 2 = food)
      const equipmentMapping = { 0: "armor", 1: "tools", 2: "food" };
      const equippableNames = fields[
        `EquipOrder_${index}`
        ]?.arrayValue?.values?.reduce(
        (result, item, index) => ({
          ...result,
          [equipmentMapping?.[index]]: item.mapValue.fields,
        }), {});
      const equipapbleAmount = fields[`EquipQTY_${index}`]?.arrayValue?.values?.reduce((result, item, index) => ({
        ...result,
        [equipmentMapping?.[index]]: item?.mapValue?.fields,
      }), {});

      const equipmentStoneData = JSON.parse(fields[`EMm0_${index}`].stringValue);
      extendedChar.equipment = createItemsWithUpgrades(equippableNames.armor, equipmentStoneData);
      const toolsStoneData = JSON.parse(fields[`EMm1_${index}`].stringValue);
      extendedChar.tools = createItemsWithUpgrades(equippableNames.tools, toolsStoneData);
      extendedChar.food = Array.from(Object.values(equippableNames.food)).reduce((res, { stringValue }, index) =>
        stringValue
          ? [...res, {
            name: itemMap?.[stringValue]?.displayName,
            rawName: stringValue,
            amount: parseInt(equipapbleAmount.food[index]?.integerValue),
          }] : res, []);

      const inventoryArr = fields[`InventoryOrder_${index}`].arrayValue.values;
      const inventoryQuantityArr = fields[`ItemQTY_${index}`].arrayValue.values;
      extendedChar.inventory = getInventory(inventoryArr, inventoryQuantityArr, character.name);


      // star signs
      const starSignsObject = fields?.[`PVtStarSign_${index}`]?.stringValue;
      extendedChar.starSigns = starSignsObject
        .split(",")
        .map((starSign) => starSignMap?.[starSign])
        .filter(item => item);

      // equipped bubbles
      const cauldronBubbles = JSON.parse(fields?.CauldronBubbles?.stringValue);
      extendedChar.equippedBubbles = cauldronBubbles?.[index].reduce(
        (res, bubbleInd) => (bubbleInd ? [...res, bubblesMap?.[bubbleInd]] : res), []);

      // crafting material in production
      const anvilCraftsMapping =
        fields[`AnvilPAselect_${index}`]?.arrayValue?.values;
      const selectedProducts = anvilCraftsMapping
        .sort((a, b) => a?.integerValue - b?.integerValue)
        .map(({ integerValue }) => anvilProductionItems[integerValue]);
      extendedChar.anvil = {
        selected: selectedProducts,
      };
      const skillsInfoObject = fields?.[`Lv0_${index}`]?.arrayValue?.values;
      extendedChar.skillsInfo = skillsInfoObject.reduce(
        (res, { integerValue }, index) =>
          integerValue !== "-1" ? { ...res, [skillIndexMap[index]]: integerValue, } : res, {});

      const cardSet = JSON.parse(fields?.[`CSetEq_${index}`]?.stringValue);
      const equippedCards = fields?.[`CardEquip_${index}`]?.arrayValue?.values
        .map(({ stringValue }) => ({
          cardName: cardEquipMap[stringValue],
          stars: account?.cards?.[cardEquipMap?.[stringValue]]?.stars,
        }))
        .filter((_, ind) => ind < 8); //cardEquipMap
      const cardsSetObject = cardSetMap[Object.keys(cardSet)?.[0]] || {};
      extendedChar.cards = {
        cardSet: {
          ...cardsSetObject,
          stars: calculateCardSetStars(cardsSetObject, Object.values(cardSet)?.[0])
        },
        equippedCards,
      };

      // printer
      const fieldsPrint = JSON.parse(fields.Print.stringValue);
      const printData = fieldsPrint.slice(5, fieldsPrint.length); // REMOVE 5 '0' ELEMENTS
      // There are 14 items per character
      // Every 2 items represent an item and it's value in the printer.
      // The first 5 pairs represent the stored samples in the printer.
      // The last 2 pairs represent the samples in production.
      const chunk = 14;
      const relevantPrinterData = printData.slice(
        index * chunk,
        index * chunk + chunk
      );
      extendedChar.printer = relevantPrinterData.reduce(
        (result, printItem, sampleIndex, array) => {
          if (sampleIndex % 2 === 0) {
            const sample = array
              .slice(sampleIndex, sampleIndex + 2)
              .map((item, sampleIndex) => sampleIndex === 0 ? itemMap?.[item]?.displayName : item);
            if (sampleIndex < 10) {
              result.stored.push({ item: sample[0], value: sample[1] });
            } else {
              result.selected.push({ item: sample[0], value: sample[1] });
            }
          }
          return result;
        },
        { stored: [], selected: [] }
      );

      const obolObject = fields[`ObolEqO0_${index}`].arrayValue.values;
      const obols = obolObject.map(({ stringValue }, index) => ({
        index: calculateWeirdObolIndex(index),
        name: obolMap[stringValue],
        rawName: stringValue,
        ...(obolCharacterShapeMap[index] ? obolCharacterShapeMap[index] : {})
      }));

      extendedChar.obols = obols.sort((a, b) => a.index - b.index);
      const talentsObject = JSON.parse(fields[`SL_${index}`].stringValue);
      const maxTalentsObject = JSON.parse(fields[`SM_${index}`].stringValue);
      const mergedObject = Object.keys(talentsObject).reduce((res, talentIndex) => ({
        ...res,
        [talentIndex]: {
          level: talentsObject?.[talentIndex],
        }
      }), {});
      const pages = talentPagesMap?.[extendedChar?.class];
      extendedChar.talents = [...pages, "Star Talents"].reduce((res, className, index) => {
        const orderedTalents = talentsMap?.[className]?.map((talentId) => ({
          talentId, ...mergedObject[talentId],
          maxLevel: maxTalentsObject[talentId]
        }));
        return {
          ...res,
          [index]: { name: className, orderedTalents }
        }
      }, {});

      const prayersArray = JSON.parse(fields[`Prayers_${index}`]?.stringValue);
      extendedChar.prayers = prayersArray.reduce((res, prayerIndex) => (prayerIndex >= 0 ? [...res, { ...prayersMap?.[prayerIndex] }] : res), []);

      // 0 - current worship charge rate
      const playerStuffArray = JSON.parse(fields[`PlayerStuff_${index}`]?.stringValue);

      extendedChar.worshipCharge = Math.round(playerStuffArray?.[0]);

      // 3 - critter name
      const trapsArray = JSON.parse(fields[`PldTraps_${index}`]?.stringValue);
      extendedChar.traps = trapsArray?.reduce((res, critterInfo) => {
        const critterName = critterInfo[3];
        return critterInfo[0] !== -1 && critterName ? [...res, {
          name: itemMap[critterName]?.displayName,
          rawName: critterName
        }] : res;
      }, []);

      const quests = JSON.parse(fields?.[`QuestComplete_${index}`].stringValue);
      extendedChar.quests = Object.keys(quests).reduce((res, key) => {
        let [npcName, questIndex] = key.split(/([0-9]+)/);
        if (npcName === 'Fishpaste') {
          npcName = 'Fishpaste97'
          questIndex = questIndex?.split('97')?.[1];
        }
        return { ...res, [npcName]: { ...(res?.[npcName] || {}), [questIndex]: quests[key] } }
      }, {});

      return {
        ...character,
        ...extendedChar,
      };
    });
  };

  const buildGuildData = (guildInfo, fields) => {
    console.log('Started building guild data');
    const guildData = {};
    const totalMembers = Object.keys(guildInfo);
    guildData.name = fields?.['OptLacc']?.arrayValue?.values?.[37]?.stringValue;
    guildData.iconId = fields?.['OptLacc']?.arrayValue?.values?.[38].integerValue;
    guildData.members = Object.keys(guildInfo).map((memberInfo, index) => {
      const {
        a: name,
        // b: unknown,
        c: className,
        d: level,
        e: guildPoints,
        f: wantedPerk,
        g: rank,
      } = guildInfo[memberInfo];
      return {
        name,
        className: classMap[className],
        level,
        guildPoints,
        wantedPerk: guildBonusesMap[wantedPerk],
        rank,
        accountId: totalMembers[index],
      };
    });

    const guildBonusesObject = JSON.parse(fields?.Guild?.stringValue);
    guildData.bonuses = guildBonusesObject[0].map((bonus, index) => ({
      name: guildBonusesMap[index],
      rawName: `Gbonus${index}`,
      level: bonus,
    }));
    console.log('Finished building guild data');
    return guildData;
  };

  const calculateWeirdObolIndex = (index) => {
    switch (index) {
      case 12:
        return 13;
      case 13:
        return 14;
      case 14:
        return 12;
      case 17:
        return 15;

      case 15:
        return 17;
      case 16:
        return 19;
      case 18:
        return 16;
      case 19:
        return 18;
      default:
        return index;
    }
  }

  const calculateCardSetStars = (card, bonus) => {
    if (!card || !bonus) return null;
    if (card.base === bonus) {
      return 0;
    } else if (bonus >= card.base * 4) {
      return 3;
    } else if (bonus >= card.base * 3) {
      return 2;
    } else if (bonus >= card.base * 2) {
      return 1;
    }
    return null;
  };

  const getInventory = (inventoryArr, inventoryQuantityArr, owner) => {
    return inventoryArr.reduce((res, { stringValue }, index) => (stringValue !== 'LockedInvSpace' && stringValue !== 'Blank' ? [
      ...res, {
        owner,
        name: itemMap?.[stringValue]?.displayName,
        rawName: stringValue,
        amount: parseInt(inventoryQuantityArr?.[index].integerValue),
      }
    ] : res), []);
  };

  const calculateStars = (card, amountOfCards) => {
    const base = cardLevelMap[card];
    // 1 star - base, 2 stars - base * 3, 3 stars - base * 5
    if (amountOfCards < base) {
      return 0;
    } else if (amountOfCards >= base * 9) {
      return 3;
    } else if (amountOfCards >= base * 4) {
      return 2;
    } else if (amountOfCards >= base) {
      return 1;
    }
    return null;
  };

  const createItemsWithUpgrades = (items, stoneData) => {
    return Array.from(Object.values(items)).reduce((res, { stringValue }, itemIndex) => {
      const stoneResult = addStoneDataToEquip(itemMap?.[stringValue], stoneData[itemIndex]);
      return stringValue ? [...res, {
        name: itemMap?.[stringValue]?.displayName, rawName: stringValue,
        ...(stringValue === 'Blank' ? {} : { ...itemMap?.[stringValue], ...stoneResult })
      }] : res
    }, []);
  }

  const addStoneDataToEquip = (baseItem, stoneData) => {
    if (!baseItem || !stoneData) return {};
    return Object.keys(stoneData)?.reduce((res, statName) => {
      const baseItemStat = baseItem?.[statName];
      const stoneStat = stoneData?.[statName];
      let sum = baseItemStat;
      if (stoneStat) {
        sum = (baseItemStat || 0) + stoneStat;
        return { ...res, [statName]: sum };
      }
      return { ...res, [statName]: baseItemStat };
    }, {});
  }

  const cloneObject = (data) => {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (err) {
      return data;
    }
  }

} catch (err) {
  console.log('Error occurred in background script', err);
}