import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import {
  Col,
  Collapse,
  Nav,
  Navbar,
  NavbarToggler,
  NavItem,
  NavLink,
  Row,
  Label,
  Input,
  UncontrolledDropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
  Spinner,
} from 'reactstrap';

import CSRFForm from 'components/CSRFForm';
import CustomImageToggler from 'components/CustomImageToggler';
import { DisplayContextProvider } from 'components/DisplayContext';
import DynamicFlash from 'components/DynamicFlash';
import CubeLayout from 'layouts/CubeLayout';
import DeckCard from 'components/DeckCard';
import SampleHandModal from 'components/SampleHandModal';
import Draft, { init } from 'utils/Draft';
import { csrfFetch } from 'utils/CSRF';
import Query from 'utils/Query';

const CubeDeckPage = ({ cube, deck, canEdit, userid, draft, defaultSeat, defaultView }) => {
  const [seatIndex, setSeatIndex] = useState(defaultSeat ?? 0);
  const [view, setView] = useState(defaultView ?? 'deck');
  const didMountRef1 = useRef(false);
  const didMountRef2 = useRef(false);

  useEffect(() => {
    if (didMountRef1.current) {
      Query.set('seat', seatIndex);
    } else {
      const querySeat = Query.get('seat');
      if (querySeat || querySeat === 0) {
        setSeatIndex(querySeat);
      }
      didMountRef1.current = true;
    }
  }, [seatIndex, setSeatIndex]);

  useEffect(() => {
    if (didMountRef2.current) {
      Query.set('view', view);
    } else {
      const queryView = Query.get('view');
      if (queryView) {
        setView(queryView);
      }
      didMountRef2.current = true;
    }
  }, [view, setView]);

  const handleChangeSeat = (event) => {
    setSeatIndex(event.target.value);
  };

  const handleChangeView = (event) => {
    setView(event.target.value);
  };

  const [isOpen, setIsOpen] = useState(false);
  const toggleNavbar = useCallback(
    (event) => {
      event.preventDefault();
      setIsOpen(!isOpen);
    },
    [isOpen],
  );

  const [loading, setLoading] = useState(false);

  const submitDeckForm = useRef();
  const [draftId, setDraftId] = useState('');

  const haveBotsRedraft = useCallback(async () => {
    if (!loading) {
      setLoading(true);
      const response = await csrfFetch(`/cube/api/redraft/${draft._id}`, {
        method: 'POST',
      });
      const json = await response.json();
      init(json.draft);
      setDraftId(Draft.id());
      await Draft.allBotsDraft();
      submitDeckForm.current.submit();
    }
  }, [draft._id, loading]);

  return (
    <CubeLayout cube={cube} cubeID={deck.cube} activeLink="playtest">
      <DisplayContextProvider>
        <CSRFForm
          key="submitdeck"
          className="d-none"
          innerRef={submitDeckForm}
          method="POST"
          action={`/cube/submitdeck/${cube._id}`}
        >
          <Input type="hidden" name="body" value={draftId} />
          <Input type="hidden" name="skipDeckbuilder" value="true" />
        </CSRFForm>
        <Navbar expand="md" light className="usercontrols mb-3">
          <div className="view-style-select pr-2">
            <Label className="sr-only" for="viewSelect">
              Cube View Style
            </Label>
            <Input type="select" id="viewSelect" value={seatIndex} onChange={handleChangeSeat}>
              {deck.seats.map((seat, index) => (
                <option key={seat._id} value={index}>
                  {seat.username ? seat.username : seat.name}
                </option>
              ))}
            </Input>
          </div>
          <div className="view-style-select pr-2">
            <Label className="sr-only" for="viewSelect">
              Cube View Style
            </Label>
            <Input type="select" id="viewSelect" value={view} onChange={handleChangeView}>
              <option value="deck">Deck View</option>
              <option value="picks">Pick by Pick Breakdown</option>
              <option value="draftbot">Draftbot Analysis</option>
            </Input>
          </div>
          <NavbarToggler onClick={toggleNavbar} className="ml-auto" />
          <Collapse isOpen={isOpen} navbar>
            <Nav navbar>
              <NavItem>
                <SampleHandModal
                  deck={deck.seats[seatIndex].deck.map((col) => col.map((cardIndex) => deck.cards[cardIndex]))}
                />
              </NavItem>
              {canEdit && (
                <NavItem>
                  <NavLink href={`/cube/deckbuilder/${deck._id}`}>Edit</NavLink>
                </NavItem>
              )}
              {loading && <Spinner className="position-absolute" />}
              <UncontrolledDropdown nav inNavbar>
                <DropdownToggle nav caret>
                  Rebuild/Redraft
                </DropdownToggle>
                <DropdownMenu right>
                  <DropdownItem href={`/cube/redraft/${deck._id}`}>Redraft</DropdownItem>
                  <DropdownItem onClick={haveBotsRedraft}>Have Bots Redraft</DropdownItem>
                  <DropdownItem href={`/cube/rebuild/${deck._id}/${seatIndex}`}>Clone and Rebuild</DropdownItem>
                </DropdownMenu>
              </UncontrolledDropdown>
              <CustomImageToggler />
              <UncontrolledDropdown nav inNavbar>
                <DropdownToggle nav caret>
                  Export
                </DropdownToggle>
                <DropdownMenu right>
                  <DropdownItem href={`/cube/deck/download/txt/${deck._id}/${seatIndex}`}>
                    Card Names (.txt)
                  </DropdownItem>
                  <DropdownItem href={`/cube/deck/download/forge/${deck._id}/${seatIndex}`}>Forge (.dck)</DropdownItem>
                  <DropdownItem href={`/cube/deck/download/xmage/${deck._id}/${seatIndex}`}>XMage (.dck)</DropdownItem>
                  <DropdownItem href={`/cube/deck/download/mtgo/${deck._id}/${seatIndex}`}>MTGO (.txt)</DropdownItem>
                  <DropdownItem href={`/cube/deck/download/arena/${deck._id}/${seatIndex}`}>Arena (.txt)</DropdownItem>
                  <DropdownItem href={`/cube/deck/download/cockatrice/${deck._id}/${seatIndex}`}>
                    Cockatrice (.txt)
                  </DropdownItem>
                </DropdownMenu>
              </UncontrolledDropdown>
            </Nav>
          </Collapse>
        </Navbar>
        <DynamicFlash />
        <Row className="mt-3">
          <Col>
            <DeckCard
              seat={deck.seats[seatIndex]}
              comments={deck.comments}
              deckid={deck._id}
              userid={userid}
              deck={deck}
              seatIndex={`${seatIndex}`}
              draft={draft}
              view={view}
            />
          </Col>
        </Row>
      </DisplayContextProvider>
    </CubeLayout>
  );
};

CubeDeckPage.propTypes = {
  cube: PropTypes.shape({ _id: PropTypes.string.isRequired }).isRequired,
  deck: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    seats: PropTypes.arrayOf(
      PropTypes.shape({
        description: PropTypes.string.isRequired,
        deck: PropTypes.array.isRequired,
        sideboard: PropTypes.array.isRequired,
        username: PropTypes.string.isRequired,
        userid: PropTypes.string,
        bot: PropTypes.array,
        name: PropTypes.string.isRequired,
      }),
    ).isRequired,
    cube: PropTypes.string.isRequired,
    comments: PropTypes.arrayOf(PropTypes.object).isRequired,
    cards: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  }).isRequired,
  canEdit: PropTypes.bool,
  userid: PropTypes.string,
  draft: PropTypes.shape({ _id: PropTypes.string.isRequired }).isRequired,
  defaultSeat: PropTypes.number,
  defaultView: PropTypes.string,
};

CubeDeckPage.defaultProps = {
  canEdit: false,
  userid: null,
  defaultSeat: 0,
  defaultView: 'deck',
};

export default CubeDeckPage;
